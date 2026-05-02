package session

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseSessionFieldsReturnsSession(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 5, 2, 12, 0, 0, 0, time.UTC)
	expiresAt := now.Add(time.Hour)

	session, parseErr := ParseSessionFields(map[string]string{
		"session_id":   "sid-123",
		"user_id":      userID.String(),
		"email":        "user@example.com",
		"name":         "User Name",
		"avatar_url":   "https://example.com/avatar.png",
		"expires_at":   expiresAt.Format(time.RFC3339Nano),
		"last_seen_at": now.Format(time.RFC3339Nano),
	}, now)
	if parseErr != nil {
		t.Fatalf("parse session fields: %v", parseErr)
	}
	if session.ID != "sid-123" || session.UserID != userID || session.ExpiresAt != expiresAt {
		t.Fatalf("unexpected session: %+v", session)
	}
}

func TestParseSessionFieldsRejectsExpiredSession(t *testing.T) {
	userID := uuid.New()
	now := time.Date(2026, 5, 2, 12, 0, 0, 0, time.UTC)

	_, parseErr := ParseSessionFields(map[string]string{
		"session_id": "sid-123",
		"user_id":    userID.String(),
		"expires_at": now.Add(-time.Second).Format(time.RFC3339Nano),
	}, now)
	if !errors.Is(parseErr, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", parseErr)
	}
}

func TestParseSessionFieldsRejectsInvalidUserID(t *testing.T) {
	now := time.Date(2026, 5, 2, 12, 0, 0, 0, time.UTC)

	_, parseErr := ParseSessionFields(map[string]string{
		"session_id": "sid-123",
		"user_id":    "not-a-uuid",
		"expires_at": now.Add(time.Hour).Format(time.RFC3339Nano),
	}, now)
	if !errors.Is(parseErr, ErrInvalid) {
		t.Fatalf("expected ErrInvalid, got %v", parseErr)
	}
}
