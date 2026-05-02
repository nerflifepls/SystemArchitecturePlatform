package realtime

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"liveeventsservice/internal/session"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 70 * time.Second
	pingPeriod     = 30 * time.Second
	maxMessageSize = 16 * 1024 * 1024
)

type outboundMessage struct {
	messageType int
	payload     []byte
}

type Connection struct {
	ID        string
	DiagramID string
	Role      string
	Session   session.Session

	hub       *Hub
	websocket *websocket.Conn
	send      chan outboundMessage
	done      chan struct{}
	logger    *log.Logger

	sendMu sync.RWMutex
	closed bool
}

func newConnection(id string, diagramID string, role string, userSession session.Session, ws *websocket.Conn, hub *Hub, logger *log.Logger) *Connection {
	return &Connection{
		ID:        id,
		DiagramID: diagramID,
		Role:      role,
		Session:   userSession,
		hub:       hub,
		websocket: ws,
		send:      make(chan outboundMessage, 64),
		done:      make(chan struct{}),
		logger:    logger,
	}
}

func (connection *Connection) enqueue(message outboundMessage) bool {
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

func (connection *Connection) closeSend() {
	connection.sendMu.Lock()
	defer connection.sendMu.Unlock()
	if connection.closed {
		return
	}
	connection.closed = true
	close(connection.done)
	close(connection.send)
}

func (connection *Connection) readPump(ctx context.Context) {
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		connection.hub.Unregister(cleanupCtx, connection)
	}()

	connection.websocket.SetReadLimit(maxMessageSize)
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

		switch messageType {
		case websocket.BinaryMessage:
			connection.hub.HandleBinary(ctx, connection, payload)
		case websocket.TextMessage:
			connection.handleText(ctx, payload)
		}
	}
}

func (connection *Connection) writePump() {
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
			writer, writerErr := connection.websocket.NextWriter(message.messageType)
			if writerErr != nil {
				return
			}
			if _, writeErr := writer.Write(message.payload); writeErr != nil {
				_ = writer.Close()
				return
			}
			if closeErr := writer.Close(); closeErr != nil {
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

func (connection *Connection) sendReady() {
	connection.enqueue(outboundMessage{
		messageType: websocket.TextMessage,
		payload: encodeJSON(readyMessage{
			Type:         "ready",
			ConnectionID: connection.ID,
			DiagramID:    connection.DiagramID,
			UserID:       connection.Session.UserID.String(),
			Role:         connection.Role,
		}),
	})
}

func (connection *Connection) handleText(ctx context.Context, payload []byte) {
	var message clientTextMessage
	if decodeErr := json.Unmarshal(payload, &message); decodeErr != nil {
		connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: encodeJSON(errorMessage{Type: "error", Code: "invalid_json", Message: "text frame must be valid JSON"})})
		return
	}

	switch message.Type {
	case "ping":
		connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: encodeJSON(pongMessage{Type: "pong", At: time.Now().UTC()})})
	case "presence:update":
		connection.hub.HandlePresenceUpdate(ctx, connection, message.Presence)
	default:
		connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: encodeJSON(errorMessage{Type: "error", Code: "unsupported_message", Message: "unsupported text message type"})})
	}
}
