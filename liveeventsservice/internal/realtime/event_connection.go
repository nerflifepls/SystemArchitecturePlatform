package realtime

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"liveeventsservice/internal/session"

	"github.com/gorilla/websocket"
)

// EventConnection is the authenticated, user-scoped socket kept open for the
// lifetime of a signed-in browser session.
type EventConnection struct {
	ID      string
	Session session.Session

	hub       *EventHub
	websocket *websocket.Conn
	send      chan outboundMessage

	sendMu sync.RWMutex
	closed bool
}

func newEventConnection(id string, userSession session.Session, ws *websocket.Conn, hub *EventHub) *EventConnection {
	return &EventConnection{
		ID:        id,
		Session:   userSession,
		hub:       hub,
		websocket: ws,
		send:      make(chan outboundMessage, 64),
	}
}

func (connection *EventConnection) enqueue(message outboundMessage) bool {
	connection.sendMu.RLock()
	defer connection.sendMu.RUnlock()
	if connection.closed {
		return false
	}
	select {
	case connection.send <- message:
		return true
	default:
		return false
	}
}

func (connection *EventConnection) closeSend() {
	connection.sendMu.Lock()
	defer connection.sendMu.Unlock()
	if connection.closed {
		return
	}
	connection.closed = true
	close(connection.send)
}

func (connection *EventConnection) readPump(ctx context.Context) {
	defer connection.hub.Unregister(connection)

	connection.websocket.SetReadLimit(64 * 1024)
	_ = connection.websocket.SetReadDeadline(time.Now().Add(pongWait))
	connection.websocket.SetPongHandler(func(string) error {
		return connection.websocket.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		messageType, payload, readErr := connection.websocket.ReadMessage()
		if readErr != nil {
			return
		}
		if messageType == websocket.TextMessage {
			connection.handleText(payload)
		}
	}
}

func (connection *EventConnection) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = connection.websocket.Close()
	}()

	for {
		select {
		case message, ok := <-connection.send:
			_ = connection.websocket.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = connection.websocket.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if writeErr := connection.websocket.WriteMessage(message.messageType, message.payload); writeErr != nil {
				return
			}
			if message.closeAfter {
				return
			}
		case <-ticker.C:
			_ = connection.websocket.SetWriteDeadline(time.Now().Add(writeWait))
			if pingErr := connection.websocket.WriteMessage(websocket.PingMessage, nil); pingErr != nil {
				return
			}
		}
	}
}

func (connection *EventConnection) sendReady() {
	connection.enqueue(outboundMessage{
		messageType: websocket.TextMessage,
		payload: encodeJSON(readyMessage{
			Type:         "ready",
			Scope:        "user",
			ConnectionID: connection.ID,
			UserID:       connection.Session.UserID.String(),
		}),
	})
}

func (connection *EventConnection) handleText(payload []byte) {
	var message clientTextMessage
	if decodeErr := json.Unmarshal(payload, &message); decodeErr != nil {
		connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: encodeJSON(errorMessage{Type: "error", Code: "invalid_json", Message: "text frame must be valid JSON"})})
		return
	}

	if message.Type == "ping" {
		connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: encodeJSON(pongMessage{Type: "pong", At: time.Now().UTC()})})
		return
	}
	connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: encodeJSON(errorMessage{Type: "error", Code: "unsupported_message", Message: "unsupported text message type"})})
}
