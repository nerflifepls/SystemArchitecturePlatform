package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend/domain"

	"github.com/google/uuid"
)

type UserRepository interface {
	UpsertGoogleUser(context.Context, domain.GoogleIdentity) (domain.User, error)
	GetUserByID(context.Context, uuid.UUID) (domain.User, error)
	GetUserByEmail(context.Context, string) (domain.User, error)
}

type SessionStore interface {
	Create(context.Context, domain.Session) error
	GetAndRefresh(context.Context, string) (domain.Session, error)
	Delete(context.Context, string) error
	DeleteUserSessionIfMatches(context.Context, uuid.UUID, string) error
}

type GoogleVerifier interface {
	Verify(context.Context, string, string) (domain.GoogleIdentity, error)
}

type AuthResult struct {
	User    domain.User
	Session domain.Session
}

type AuthService struct {
	users          UserRepository
	sessions       SessionStore
	verifier       GoogleVerifier
	googleClientID string
	sessionTTL     time.Duration
	now            func() time.Time
}

func NewAuthService(users UserRepository, sessions SessionStore, verifier GoogleVerifier, googleClientID string, sessionTTL time.Duration) *AuthService {
	return &AuthService{
		users:          users,
		sessions:       sessions,
		verifier:       verifier,
		googleClientID: googleClientID,
		sessionTTL:     sessionTTL,
		now:            time.Now,
	}
}

func (service *AuthService) LoginWithGoogle(ctx context.Context, idToken string) (AuthResult, error) {
	trimmedToken := strings.TrimSpace(idToken)
	if trimmedToken == "" {
		return AuthResult{}, Validation("idToken is required", map[string]string{"idToken": "required"})
	}
	if service == nil || service.users == nil || service.sessions == nil {
		return AuthResult{}, Unavailable("auth persistence is not configured")
	}
	if service.verifier == nil || service.googleClientID == "" {
		return AuthResult{}, Unavailable("Google token verification is not configured")
	}

	identity, verifyErr := service.verifier.Verify(ctx, trimmedToken, service.googleClientID)
	if verifyErr != nil {
		return AuthResult{}, Unauthorized("invalid Google token")
	}
	if !identity.EmailVerified {
		return AuthResult{}, Validation("Google account email is not verified", map[string]string{"emailVerified": "false"})
	}

	identity.Email = strings.ToLower(strings.TrimSpace(identity.Email))
	identity.DisplayName = strings.TrimSpace(identity.DisplayName)
	if identity.DisplayName == "" {
		identity.DisplayName = identity.Email
	}

	user, upsertErr := service.users.UpsertGoogleUser(ctx, identity)
	if upsertErr != nil {
		return AuthResult{}, mapRepositoryError(upsertErr, "user")
	}

	sessionID, generateErr := generateSessionID()
	if generateErr != nil {
		return AuthResult{}, Internal("failed to generate session")
	}

	now := service.now().UTC()
	session := domain.Session{
		ID:         sessionID,
		UserID:     user.ID,
		GoogleSub:  user.GoogleSub,
		Email:      user.Email,
		Name:       user.DisplayName,
		AvatarURL:  user.AvatarURL,
		CreatedAt:  now,
		ExpiresAt:  now.Add(service.sessionTTL),
		LastSeenAt: now,
	}

	if createErr := service.sessions.Create(ctx, session); createErr != nil {
		return AuthResult{}, Unavailable("failed to create session")
	}
	return AuthResult{User: user, Session: session}, nil
}

func (service *AuthService) AuthenticateSession(ctx context.Context, sessionID string) (AuthResult, error) {
	if strings.TrimSpace(sessionID) == "" {
		return AuthResult{}, Unauthorized("session cookie is required")
	}
	if service == nil || service.users == nil || service.sessions == nil {
		return AuthResult{}, Unavailable("auth persistence is not configured")
	}

	session, sessionErr := service.sessions.GetAndRefresh(ctx, sessionID)
	if sessionErr != nil {
		if errors.Is(sessionErr, domain.ErrSessionNotFound) {
			return AuthResult{}, Unauthorized("session is invalid or expired")
		}
		return AuthResult{}, Unavailable("failed to validate session")
	}

	user, userErr := service.users.GetUserByID(ctx, session.UserID)
	if userErr != nil {
		if errors.Is(userErr, domain.ErrNotFound) {
			return AuthResult{}, Unauthorized("session user no longer exists")
		}
		return AuthResult{}, mapRepositoryError(userErr, "user")
	}
	return AuthResult{User: user, Session: session}, nil
}

func (service *AuthService) LogoutBySessionID(ctx context.Context, sessionID string) error {
	trimmedSessionID := strings.TrimSpace(sessionID)
	if trimmedSessionID == "" {
		return nil
	}
	if service == nil || service.sessions == nil {
		return Unavailable("session persistence is not configured")
	}

	session, sessionErr := service.sessions.GetAndRefresh(ctx, trimmedSessionID)
	if sessionErr != nil && !errors.Is(sessionErr, domain.ErrSessionNotFound) {
		return Unavailable("failed to read session")
	}
	if deleteErr := service.sessions.Delete(ctx, trimmedSessionID); deleteErr != nil {
		return Unavailable("failed to delete session")
	}
	if sessionErr == nil {
		if deleteUserErr := service.sessions.DeleteUserSessionIfMatches(ctx, session.UserID, trimmedSessionID); deleteUserErr != nil {
			return Unavailable("failed to clear user session index")
		}
	}
	return nil
}

func generateSessionID() (string, error) {
	randomBytes := make([]byte, 32)
	if _, readErr := rand.Read(randomBytes); readErr != nil {
		return "", fmt.Errorf("read random bytes: %w", readErr)
	}
	return base64.RawURLEncoding.EncodeToString(randomBytes), nil
}

func mapRepositoryError(repositoryErr error, resource string) error {
	if errors.Is(repositoryErr, domain.ErrNotFound) {
		return NotFound(resource + " not found")
	}
	if errors.Is(repositoryErr, domain.ErrConflict) {
		return Conflict(resource + " already exists")
	}
	return Internal("database operation failed")
}
