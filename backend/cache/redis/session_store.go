package rediscache

import (
	"context"
	"errors"
	"fmt"
	"time"

	"backend/domain"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

type SessionStore struct {
	client *goredis.Client
	ttl    time.Duration
	now    func() time.Time
}

func NewSessionStore(client *goredis.Client, ttl time.Duration) *SessionStore {
	return &SessionStore{client: client, ttl: ttl, now: time.Now}
}

func (store *SessionStore) Create(ctx context.Context, session domain.Session) error {
	if store == nil || store.client == nil {
		return fmt.Errorf("redis client is nil")
	}
	activeKey := userSessionKey(session.UserID)
	oldSessionID, getErr := store.client.Get(ctx, activeKey).Result()
	if getErr != nil && !errors.Is(getErr, goredis.Nil) {
		return getErr
	}

	pipeline := store.client.TxPipeline()
	if oldSessionID != "" && oldSessionID != session.ID {
		pipeline.Del(ctx, sessionKey(oldSessionID))
	}
	pipeline.HSet(ctx, sessionKey(session.ID), sessionFields(session))
	pipeline.Expire(ctx, sessionKey(session.ID), store.ttl)
	pipeline.Set(ctx, activeKey, session.ID, store.ttl)
	_, execErr := pipeline.Exec(ctx)
	return execErr
}

func (store *SessionStore) GetAndRefresh(ctx context.Context, sessionID string) (domain.Session, error) {
	if store == nil || store.client == nil {
		return domain.Session{}, fmt.Errorf("redis client is nil")
	}
	values, getErr := store.client.HGetAll(ctx, sessionKey(sessionID)).Result()
	if getErr != nil {
		return domain.Session{}, getErr
	}
	if len(values) == 0 {
		return domain.Session{}, domain.ErrSessionNotFound
	}
	session, parseErr := parseSession(values)
	if parseErr != nil {
		return domain.Session{}, parseErr
	}
	activeSessionID, activeErr := store.client.Get(ctx, userSessionKey(session.UserID)).Result()
	if activeErr != nil {
		if errors.Is(activeErr, goredis.Nil) {
			return domain.Session{}, domain.ErrSessionNotFound
		}
		return domain.Session{}, activeErr
	}
	if activeSessionID != sessionID {
		return domain.Session{}, domain.ErrSessionNotFound
	}

	now := store.now().UTC()
	session.LastSeenAt = now
	session.ExpiresAt = now.Add(store.ttl)
	pipeline := store.client.TxPipeline()
	pipeline.HSet(ctx, sessionKey(session.ID), map[string]any{
		"last_seen_at": session.LastSeenAt.Format(time.RFC3339Nano),
		"expires_at":   session.ExpiresAt.Format(time.RFC3339Nano),
	})
	pipeline.Expire(ctx, sessionKey(session.ID), store.ttl)
	pipeline.Expire(ctx, userSessionKey(session.UserID), store.ttl)
	if _, execErr := pipeline.Exec(ctx); execErr != nil {
		return domain.Session{}, execErr
	}
	return session, nil
}

func (store *SessionStore) Delete(ctx context.Context, sessionID string) error {
	if store == nil || store.client == nil {
		return fmt.Errorf("redis client is nil")
	}
	return store.client.Del(ctx, sessionKey(sessionID)).Err()
}

func (store *SessionStore) DeleteUserSessionIfMatches(ctx context.Context, userID uuid.UUID, sessionID string) error {
	if store == nil || store.client == nil {
		return fmt.Errorf("redis client is nil")
	}
	const deleteIfMatch = `
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("DEL", KEYS[1])
		end
		return 0
	`
	return store.client.Eval(ctx, deleteIfMatch, []string{userSessionKey(userID)}, sessionID).Err()
}

func sessionFields(session domain.Session) map[string]any {
	avatarURL := ""
	if session.AvatarURL != nil {
		avatarURL = *session.AvatarURL
	}
	return map[string]any{
		"session_id":   session.ID,
		"user_id":      session.UserID.String(),
		"google_sub":   session.GoogleSub,
		"email":        session.Email,
		"name":         session.Name,
		"avatar_url":   avatarURL,
		"created_at":   session.CreatedAt.UTC().Format(time.RFC3339Nano),
		"expires_at":   session.ExpiresAt.UTC().Format(time.RFC3339Nano),
		"last_seen_at": session.LastSeenAt.UTC().Format(time.RFC3339Nano),
	}
}

func parseSession(values map[string]string) (domain.Session, error) {
	userID, userErr := uuid.Parse(values["user_id"])
	if userErr != nil {
		return domain.Session{}, userErr
	}
	createdAt, createdErr := time.Parse(time.RFC3339Nano, values["created_at"])
	if createdErr != nil {
		return domain.Session{}, createdErr
	}
	expiresAt, expiresErr := time.Parse(time.RFC3339Nano, values["expires_at"])
	if expiresErr != nil {
		return domain.Session{}, expiresErr
	}
	lastSeenAt, lastSeenErr := time.Parse(time.RFC3339Nano, values["last_seen_at"])
	if lastSeenErr != nil {
		return domain.Session{}, lastSeenErr
	}
	var avatarURL *string
	if values["avatar_url"] != "" {
		avatarURLValue := values["avatar_url"]
		avatarURL = &avatarURLValue
	}
	return domain.Session{
		ID:         values["session_id"],
		UserID:     userID,
		GoogleSub:  values["google_sub"],
		Email:      values["email"],
		Name:       values["name"],
		AvatarURL:  avatarURL,
		CreatedAt:  createdAt,
		ExpiresAt:  expiresAt,
		LastSeenAt: lastSeenAt,
	}, nil
}

func sessionKey(sessionID string) string {
	return "session:" + sessionID
}

func userSessionKey(userID uuid.UUID) string {
	return "user:" + userID.String() + ":session"
}
