package rediscache

import (
	"context"
	"errors"
	"testing"
	"time"

	"backend/domain"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

func TestSessionStoreCreateEnforcesSingleActiveSession(t *testing.T) {
	redisServer, serverErr := miniredis.Run()
	if serverErr != nil {
		t.Fatalf("start miniredis: %v", serverErr)
	}
	defer redisServer.Close()

	client := goredis.NewClient(&goredis.Options{Addr: redisServer.Addr()})
	defer func() { _ = client.Close() }()

	store := NewSessionStore(client, time.Hour)
	ctx := context.Background()
	userID := uuid.New()
	firstSession := testSession("first", userID)
	secondSession := testSession("second", userID)

	if createErr := store.Create(ctx, firstSession); createErr != nil {
		t.Fatalf("create first session: %v", createErr)
	}
	assertRedisString(t, redisServer, "user:"+userID.String()+":session", "first")
	if !redisServer.Exists("session:first") {
		t.Fatalf("expected session:first key to exist")
	}

	if createErr := store.Create(ctx, secondSession); createErr != nil {
		t.Fatalf("create second session: %v", createErr)
	}
	assertRedisString(t, redisServer, "user:"+userID.String()+":session", "second")
	if redisServer.Exists("session:first") {
		t.Fatalf("expected old session:first key to be deleted")
	}
	if !redisServer.Exists("session:second") {
		t.Fatalf("expected session:second key to exist")
	}

	if _, getErr := store.GetAndRefresh(ctx, "first"); !errors.Is(getErr, domain.ErrSessionNotFound) {
		t.Fatalf("expected first session to be invalid, got %v", getErr)
	}
	refreshedSession, getErr := store.GetAndRefresh(ctx, "second")
	if getErr != nil {
		t.Fatalf("get second session: %v", getErr)
	}
	if refreshedSession.ID != "second" || refreshedSession.UserID != userID {
		t.Fatalf("unexpected refreshed session: %+v", refreshedSession)
	}
	if ttl := redisServer.TTL("session:second"); ttl <= 0 {
		t.Fatalf("expected session:second to have ttl, got %s", ttl)
	}
}

func TestSessionStoreDeleteUserSessionIfMatches(t *testing.T) {
	redisServer, serverErr := miniredis.Run()
	if serverErr != nil {
		t.Fatalf("start miniredis: %v", serverErr)
	}
	defer redisServer.Close()

	client := goredis.NewClient(&goredis.Options{Addr: redisServer.Addr()})
	defer func() { _ = client.Close() }()

	store := NewSessionStore(client, time.Hour)
	ctx := context.Background()
	userID := uuid.New()
	if createErr := store.Create(ctx, testSession("current", userID)); createErr != nil {
		t.Fatalf("create session: %v", createErr)
	}

	if deleteErr := store.DeleteUserSessionIfMatches(ctx, userID, "other"); deleteErr != nil {
		t.Fatalf("delete mismatched session: %v", deleteErr)
	}
	assertRedisString(t, redisServer, "user:"+userID.String()+":session", "current")

	if deleteErr := store.DeleteUserSessionIfMatches(ctx, userID, "current"); deleteErr != nil {
		t.Fatalf("delete matching session: %v", deleteErr)
	}
	if redisServer.Exists("user:" + userID.String() + ":session") {
		t.Fatalf("expected user session index to be deleted")
	}
}

func testSession(sessionID string, userID uuid.UUID) domain.Session {
	now := time.Now().UTC().Truncate(time.Second)
	return domain.Session{
		ID:         sessionID,
		UserID:     userID,
		GoogleSub:  "google-sub",
		Email:      "user@example.com",
		Name:       "User",
		CreatedAt:  now,
		ExpiresAt:  now.Add(time.Hour),
		LastSeenAt: now,
	}
}

func assertRedisString(t *testing.T, redisServer *miniredis.Miniredis, key string, expectedValue string) {
	t.Helper()
	actualValue, getErr := redisServer.Get(key)
	if getErr != nil {
		t.Fatalf("get %s: %v", key, getErr)
	}
	if actualValue != expectedValue {
		t.Fatalf("expected %s to equal %q, got %q", key, expectedValue, actualValue)
	}
}
