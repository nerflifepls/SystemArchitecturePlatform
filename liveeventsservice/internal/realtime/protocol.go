// Package realtime manages websocket connections, Redis presence, and CRDT update relay.
package realtime

import (
	"encoding/json"
	"time"
)

type readyMessage struct {
	Type         string `json:"type"`
	ConnectionID string `json:"connectionId"`
	Scope        string `json:"scope,omitempty"`
	DiagramID    string `json:"diagramId,omitempty"`
	ProjectID    string `json:"projectId,omitempty"`
	WorkspaceID  string `json:"workspaceId,omitempty"`
	UserID       string `json:"userId"`
	Role         string `json:"role,omitempty"`
}

type pongMessage struct {
	Type string    `json:"type"`
	At   time.Time `json:"at"`
}

type errorMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type liveEvent struct {
	ID              string    `json:"id"`
	Type            string    `json:"type"`
	OccurredAt      time.Time `json:"occurredAt"`
	ActorUserID     string    `json:"actorUserId"`
	WorkspaceID     string    `json:"workspaceId,omitempty"`
	ProjectID       string    `json:"projectId,omitempty"`
	DiagramID       string    `json:"diagramId,omitempty"`
	SubjectUserID   string    `json:"subjectUserId,omitempty"`
	Role            string    `json:"role,omitempty"`
	SnapshotVersion int64     `json:"snapshotVersion,omitempty"`
}

type accessMessage struct {
	Type        string `json:"type"`
	Reason      string `json:"reason,omitempty"`
	WorkspaceID string `json:"workspaceId"`
	ProjectID   string `json:"projectId,omitempty"`
	DiagramID   string `json:"diagramId,omitempty"`
	Role        string `json:"role,omitempty"`
}

type clientTextMessage struct {
	Type     string          `json:"type"`
	Presence json.RawMessage `json:"presence,omitempty"`
}

type updateEnvelope struct {
	Type               string    `json:"type"`
	DiagramID          string    `json:"diagramId"`
	OriginConnectionID string    `json:"originConnectionId"`
	OriginInstanceID   string    `json:"originInstanceId"`
	UserID             string    `json:"userId"`
	Data               string    `json:"data"`
	SentAt             time.Time `json:"sentAt"`
}

type presenceEnvelope struct {
	Type         string          `json:"type"`
	DiagramID    string          `json:"diagramId"`
	ConnectionID string          `json:"connectionId"`
	UserID       string          `json:"userId"`
	Name         string          `json:"name,omitempty"`
	Email        string          `json:"email,omitempty"`
	AvatarURL    string          `json:"avatarUrl,omitempty"`
	Presence     json.RawMessage `json:"presence,omitempty"`
	SentAt       time.Time       `json:"sentAt"`
}

func encodeJSON(value any) []byte {
	encodedValue, encodeErr := json.Marshal(value)
	if encodeErr != nil {
		return []byte(`{"type":"error","code":"encode_failed","message":"failed to encode message"}`)
	}
	return encodedValue
}
