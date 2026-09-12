package realtime

import (
	"context"
	"encoding/json"
	"testing"

	"liveeventsservice/internal/session"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func TestWorkspaceRoleEventDowngradesAnOpenDiagramConnection(t *testing.T) {
	userID := uuid.New()
	connection := &Connection{
		ID:          "connection-1",
		DiagramID:   "diagram-1",
		ProjectID:   "project-1",
		WorkspaceID: "workspace-1",
		Session:     session.Session{UserID: userID},
		role:        "editor",
		send:        make(chan outboundMessage, 2),
	}
	hub := &Hub{rooms: map[string]*room{
		"diagram-1": {connections: map[string]*Connection{connection.ID: connection}},
	}}
	payload, _ := json.Marshal(liveEvent{
		Type:          "workspace.member.updated",
		WorkspaceID:   "workspace-1",
		SubjectUserID: userID.String(),
		Role:          "viewer",
	})

	hub.handleWorkspaceEvent("diagram-1", payload)

	if got := connection.currentRole(); got != "viewer" {
		t.Fatalf("role = %q, want viewer", got)
	}
	message := <-connection.send
	if message.messageType != websocket.TextMessage {
		t.Fatalf("message type = %d, want text", message.messageType)
	}
	var access accessMessage
	if decodeErr := json.Unmarshal(message.payload, &access); decodeErr != nil {
		t.Fatalf("decode access message: %v", decodeErr)
	}
	if access.Type != "access:changed" || access.Role != "viewer" {
		t.Fatalf("unexpected access message: %+v", access)
	}

	hub.HandleBinary(context.Background(), connection, []byte{1})
	rejection := <-connection.send
	var response errorMessage
	if decodeErr := json.Unmarshal(rejection.payload, &response); decodeErr != nil {
		t.Fatalf("decode rejection: %v", decodeErr)
	}
	if response.Code != "editor_role_required" {
		t.Fatalf("code = %q, want editor_role_required", response.Code)
	}
}

func TestWorkspaceRemovalEventRevokesAnOpenDiagramConnection(t *testing.T) {
	userID := uuid.New()
	connection := &Connection{
		ID:          "connection-1",
		DiagramID:   "diagram-1",
		ProjectID:   "project-1",
		WorkspaceID: "workspace-1",
		Session:     session.Session{UserID: userID},
		role:        "editor",
		send:        make(chan outboundMessage, 1),
	}
	hub := &Hub{rooms: map[string]*room{
		"diagram-1": {connections: map[string]*Connection{connection.ID: connection}},
	}}
	payload, _ := json.Marshal(liveEvent{
		Type:          "workspace.member.removed",
		WorkspaceID:   "workspace-1",
		SubjectUserID: userID.String(),
	})

	hub.handleWorkspaceEvent("diagram-1", payload)

	message := <-connection.send
	if !message.closeAfter {
		t.Fatal("expected revocation frame to close the websocket after delivery")
	}
	var access accessMessage
	if decodeErr := json.Unmarshal(message.payload, &access); decodeErr != nil {
		t.Fatalf("decode access message: %v", decodeErr)
	}
	if access.Type != "access:revoked" || access.Reason != "membership_removed" {
		t.Fatalf("unexpected access message: %+v", access)
	}

	staleRoleUpdate, _ := json.Marshal(liveEvent{
		Type:          "workspace.member.updated",
		WorkspaceID:   "workspace-1",
		SubjectUserID: userID.String(),
		Role:          "editor",
	})
	hub.handleWorkspaceEvent("diagram-1", staleRoleUpdate)
	if got := connection.currentRole(); got != "" {
		t.Fatalf("revoked connection role = %q, want empty", got)
	}
	hub.HandleBinary(context.Background(), connection, []byte{1})
	rejection := <-connection.send
	var response errorMessage
	if decodeErr := json.Unmarshal(rejection.payload, &response); decodeErr != nil {
		t.Fatalf("decode post-revocation response: %v", decodeErr)
	}
	if response.Code != "editor_role_required" {
		t.Fatalf("post-revocation code = %q, want editor_role_required", response.Code)
	}
}
