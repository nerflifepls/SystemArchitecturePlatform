// Package session validates backend-issued Redis sessions for websocket clients.
package session

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

var (
	ErrNotFound = errors.New("session not found")
	ErrInactive = errors.New("session is not active")
	ErrInvalid  = errors.New("session is invalid")
)

// Session is the authenticated browser session used by a websocket connection.
type Session struct {
	ID         string
	UserID     uuid.UUID
	Email      string
	Name       string
	AvatarURL  string
	ExpiresAt  time.Time
	LastSeenAt time.Time
}

// Store validates sessions against Redis session and active-user keys.
type Store struct {
	client *goredis.Client
	now    func() time.Time
}

// NewStore creates a Redis-backed session store.
func NewStore(client *goredis.Client) *Store {
	return &Store{client: client, now: time.Now}
}

// Validate loads and checks a session id against the active user session key.
func (store *Store) Validate(ctx context.Context, sessionID string) (Session, error) {
	trimmedSessionID := strings.TrimSpace(sessionID)
	if trimmedSessionID == "" {
		return Session{}, ErrNotFound
	}
	if store == nil || store.client == nil {
		return Session{}, fmt.Errorf("redis client is nil")
	}

	values, getErr := store.client.HGetAll(ctx, SessionKey(trimmedSessionID)).Result()
	if getErr != nil {
		return Session{}, getErr
	}
	if len(values) == 0 {
		return Session{}, ErrNotFound
	}

	session, parseErr := ParseSessionFields(values, store.now().UTC())
	if parseErr != nil {
		return Session{}, parseErr
	}
	if session.ID != trimmedSessionID {
		return Session{}, ErrInvalid
	}

	activeSessionID, activeErr := store.client.Get(ctx, UserSessionKey(session.UserID)).Result()
	if activeErr != nil {
		if errors.Is(activeErr, goredis.Nil) {
			return Session{}, ErrNotFound
		}
		return Session{}, activeErr
	}
	if activeSessionID != trimmedSessionID {
		return Session{}, ErrInactive
	}

	return session, nil
}

// ParseSessionFields converts Redis hash fields into a Session value.
func ParseSessionFields(values map[string]string, now time.Time) (Session, error) {
	sessionID := strings.TrimSpace(values["session_id"])
	if sessionID == "" {
		return Session{}, ErrInvalid
	}

	userID, userErr := uuid.Parse(strings.TrimSpace(values["user_id"]))
	if userErr != nil {
		return Session{}, ErrInvalid
	}

	expiresAt, expiresErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(values["expires_at"]))
	if expiresErr != nil {
		return Session{}, ErrInvalid
	}
	if !expiresAt.IsZero() && !now.IsZero() && !expiresAt.After(now) {
		return Session{}, ErrNotFound
	}

	var lastSeenAt time.Time
	if rawLastSeenAt := strings.TrimSpace(values["last_seen_at"]); rawLastSeenAt != "" {
		parsedLastSeenAt, lastSeenErr := time.Parse(time.RFC3339Nano, rawLastSeenAt)
		if lastSeenErr != nil {
			return Session{}, ErrInvalid
		}
		lastSeenAt = parsedLastSeenAt
	}

	return Session{
		ID:         sessionID,
		UserID:     userID,
		Email:      strings.TrimSpace(values["email"]),
		Name:       strings.TrimSpace(values["name"]),
		AvatarURL:  strings.TrimSpace(values["avatar_url"]),
		ExpiresAt:  expiresAt,
		LastSeenAt: lastSeenAt,
	}, nil
}

// SessionKey returns the Redis hash key for a backend browser session.
func SessionKey(sessionID string) string {
	return "session:" + sessionID
}

// UserSessionKey returns the Redis key containing the active session id for a user.
func UserSessionKey(userID uuid.UUID) string {
	return "user:" + userID.String() + ":session"
}
