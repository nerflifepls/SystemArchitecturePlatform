package realtime

import (
	"context"
	"encoding/json"
	"testing"

	"liveeventsservice/internal/session"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func TestCanEditRole(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{role: "owner", want: true},
		{role: "admin", want: true},
		{role: "editor", want: true},
		{role: "viewer", want: false},
		{role: "", want: false},
		{role: "unknown", want: false},
	}

	for _, test := range tests {
		t.Run(test.role, func(t *testing.T) {
			if got := canEditRole(test.role); got != test.want {
				t.Fatalf("canEditRole(%q) = %v, want %v", test.role, got, test.want)
			}
		})
	}
}

func TestHandleBinaryRejectsViewerBeforeBroadcast(t *testing.T) {
	connection := &Connection{
		role: "viewer",
		send: make(chan outboundMessage, 1),
	}

	(&Hub{}).HandleBinary(context.Background(), connection, []byte{1, 2, 3})

	select {
	case message := <-connection.send:
		if message.messageType != websocket.TextMessage {
			t.Fatalf("message type = %d, want text", message.messageType)
		}
		var response errorMessage
		if err := json.Unmarshal(message.payload, &response); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if response.Code != "editor_role_required" {
			t.Fatalf("code = %q, want editor_role_required", response.Code)
		}
	default:
		t.Fatal("expected viewer rejection message")
	}
}

func TestReadyFrameIncludesAuthorizedResourceAncestry(t *testing.T) {
	userID := uuid.New()
	connection := &Connection{
		ID:          "connection-1",
		DiagramID:   "diagram-1",
		ProjectID:   "project-1",
		WorkspaceID: "workspace-1",
		Session:     session.Session{UserID: userID},
		role:        "viewer",
		send:        make(chan outboundMessage, 1),
	}

	connection.sendReady()
	message := <-connection.send
	var ready readyMessage
	if decodeErr := json.Unmarshal(message.payload, &ready); decodeErr != nil {
		t.Fatalf("decode ready frame: %v", decodeErr)
	}
	if ready.DiagramID != "diagram-1" || ready.ProjectID != "project-1" || ready.WorkspaceID != "workspace-1" || ready.Role != "viewer" {
		t.Fatalf("unexpected ready frame: %+v", ready)
	}
}
