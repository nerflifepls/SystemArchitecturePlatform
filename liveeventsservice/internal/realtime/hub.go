package realtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	goredis "github.com/redis/go-redis/v9"
)

const (
	redisPresenceTTL       = 90 * time.Second
	ttlRefreshInterval     = 30 * time.Second
	redisOperationTimeout  = 3 * time.Second
	staleConnectionTimeout = 5 * time.Second
)

// Hub tracks active diagram rooms and coordinates Redis pub/sub relay.
type Hub struct {
	redis      *goredis.Client
	instanceID string
	logger     *log.Logger

	mu       sync.RWMutex
	rooms    map[string]*room
	closed   bool
	closeAll sync.Once
}

type room struct {
	diagramID    string
	connections  map[string]*Connection
	subscription context.CancelFunc
}

// NewHub creates a realtime hub for one service instance.
func NewHub(redisClient *goredis.Client, instanceID string, logger *log.Logger) *Hub {
	return &Hub{
		redis:      redisClient,
		instanceID: instanceID,
		logger:     logger,
		rooms:      make(map[string]*room),
	}
}

// Register adds a websocket connection to its diagram room and writes presence state.
func (hub *Hub) Register(ctx context.Context, connection *Connection) error {
	if writeErr := hub.writeConnectionState(ctx, connection); writeErr != nil {
		return writeErr
	}

	hub.mu.Lock()
	defer hub.mu.Unlock()
	if hub.closed {
		return context.Canceled
	}

	currentRoom := hub.rooms[connection.DiagramID]
	if currentRoom == nil {
		subscriptionCtx, cancelSubscription := context.WithCancel(context.Background())
		currentRoom = &room{diagramID: connection.DiagramID, connections: make(map[string]*Connection), subscription: cancelSubscription}
		hub.rooms[connection.DiagramID] = currentRoom
		go hub.subscribe(subscriptionCtx, connection.DiagramID)
	}
	currentRoom.connections[connection.ID] = connection
	go hub.refreshConnectionTTL(connection)
	return nil
}

// SendPresenceSnapshot sends the current Redis presence hash to a newly connected client.
func (hub *Hub) SendPresenceSnapshot(ctx context.Context, connection *Connection) {
	values, valuesErr := hub.redis.HVals(ctx, diagramPresenceKey(connection.DiagramID)).Result()
	if valuesErr != nil {
		if hub.logger != nil {
			hub.logger.Printf("read presence snapshot for %s: %v", connection.DiagramID, valuesErr)
		}
		return
	}

	for _, value := range values {
		if value == "" {
			continue
		}

		connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: []byte(value)})
	}
}

// Unregister removes a websocket connection and publishes a leave event when needed.
func (hub *Hub) Unregister(ctx context.Context, connection *Connection) {
	removed := false

	hub.mu.Lock()
	currentRoom := hub.rooms[connection.DiagramID]
	if currentRoom != nil {
		if _, exists := currentRoom.connections[connection.ID]; exists {
			delete(currentRoom.connections, connection.ID)
			removed = true
		}
		if len(currentRoom.connections) == 0 {
			currentRoom.subscription()
			delete(hub.rooms, connection.DiagramID)
		}
	}
	hub.mu.Unlock()

	if !removed {
		return
	}

	connection.closeSend()
	if cleanupErr := hub.cleanupConnectionState(ctx, connection); cleanupErr != nil && hub.logger != nil {
		hub.logger.Printf("cleanup websocket connection %s: %v", connection.ID, cleanupErr)
	}
}

// Close shuts down all rooms and cleans connection state from Redis.
func (hub *Hub) Close(ctx context.Context) {
	hub.closeAll.Do(func() {
		hub.mu.Lock()
		hub.closed = true
		connections := make([]*Connection, 0)
		for diagramID, currentRoom := range hub.rooms {
			currentRoom.subscription()
			for _, connection := range currentRoom.connections {
				connections = append(connections, connection)
			}
			delete(hub.rooms, diagramID)
		}
		hub.mu.Unlock()

		for _, connection := range connections {
			connection.closeSend()
			if cleanupErr := hub.cleanupConnectionState(ctx, connection); cleanupErr != nil && hub.logger != nil {
				hub.logger.Printf("cleanup websocket connection %s: %v", connection.ID, cleanupErr)
			}
		}
	})
}

// HandleBinary relays a Yjs update locally and through Redis pub/sub.
func (hub *Hub) HandleBinary(ctx context.Context, connection *Connection, payload []byte) {
	if !canEditRole(connection.Role) {
		connection.enqueue(outboundMessage{
			messageType: websocket.TextMessage,
			payload: encodeJSON(errorMessage{
				Type:    "error",
				Code:    "editor_role_required",
				Message: "editor role is required to update this diagram",
			}),
		})
		return
	}

	messagePayload := append([]byte(nil), payload...)
	hub.broadcastBinary(connection.DiagramID, messagePayload, connection.ID)

	envelope := updateEnvelope{
		Type:               "update",
		DiagramID:          connection.DiagramID,
		OriginConnectionID: connection.ID,
		OriginInstanceID:   hub.instanceID,
		UserID:             connection.Session.UserID.String(),
		Data:               base64.StdEncoding.EncodeToString(messagePayload),
		SentAt:             time.Now().UTC(),
	}
	if publishErr := hub.redis.Publish(ctx, diagramUpdatesChannel(connection.DiagramID), encodeJSON(envelope)).Err(); publishErr != nil && hub.logger != nil {
		hub.logger.Printf("publish diagram update for %s: %v", connection.DiagramID, publishErr)
	}
}

// HandlePresenceUpdate stores and broadcasts a websocket presence frame.
func (hub *Hub) HandlePresenceUpdate(ctx context.Context, connection *Connection, presence json.RawMessage) {
	envelope := presenceEnvelope{
		Type:         "presence:update",
		DiagramID:    connection.DiagramID,
		ConnectionID: connection.ID,
		UserID:       connection.Session.UserID.String(),
		Name:         connection.Session.Name,
		Email:        connection.Session.Email,
		AvatarURL:    connection.Session.AvatarURL,
		Presence:     presence,
		SentAt:       time.Now().UTC(),
	}
	payload := encodeJSON(envelope)
	pipeline := hub.redis.TxPipeline()
	pipeline.HSet(ctx, diagramPresenceKey(connection.DiagramID), connection.ID, payload)
	pipeline.Expire(ctx, diagramPresenceKey(connection.DiagramID), redisPresenceTTL)
	pipeline.Expire(ctx, wsConnectionKey(connection.ID), redisPresenceTTL)
	pipeline.Expire(ctx, diagramConnectionsKey(connection.DiagramID), redisPresenceTTL)
	pipeline.Expire(ctx, diagramActiveUsersKey(connection.DiagramID), redisPresenceTTL)
	if _, execErr := pipeline.Exec(ctx); execErr != nil {
		connection.enqueue(outboundMessage{messageType: websocket.TextMessage, payload: encodeJSON(errorMessage{Type: "error", Code: "presence_failed", Message: "failed to update presence"})})
		if hub.logger != nil {
			hub.logger.Printf("update presence for connection %s: %v", connection.ID, execErr)
		}
		return
	}
	if publishErr := hub.redis.Publish(ctx, diagramPresenceChannel(connection.DiagramID), payload).Err(); publishErr != nil && hub.logger != nil {
		hub.logger.Printf("publish presence update for %s: %v", connection.DiagramID, publishErr)
	}
}

func (hub *Hub) writeConnectionState(ctx context.Context, connection *Connection) error {
	now := time.Now().UTC()
	presencePayload := encodeJSON(presenceEnvelope{
		Type:         "presence:join",
		DiagramID:    connection.DiagramID,
		ConnectionID: connection.ID,
		UserID:       connection.Session.UserID.String(),
		Name:         connection.Session.Name,
		Email:        connection.Session.Email,
		AvatarURL:    connection.Session.AvatarURL,
		SentAt:       now,
	})

	pipeline := hub.redis.TxPipeline()
	pipeline.HSet(ctx, wsConnectionKey(connection.ID), map[string]any{
		"connection_id": connection.ID,
		"diagram_id":    connection.DiagramID,
		"user_id":       connection.Session.UserID.String(),
		"session_id":    connection.Session.ID,
		"instance_id":   hub.instanceID,
		"connected_at":  now.Format(time.RFC3339Nano),
	})
	pipeline.Expire(ctx, wsConnectionKey(connection.ID), redisPresenceTTL)
	pipeline.SAdd(ctx, diagramConnectionsKey(connection.DiagramID), connection.ID)
	pipeline.Expire(ctx, diagramConnectionsKey(connection.DiagramID), redisPresenceTTL)
	pipeline.HSet(ctx, diagramPresenceKey(connection.DiagramID), connection.ID, presencePayload)
	pipeline.Expire(ctx, diagramPresenceKey(connection.DiagramID), redisPresenceTTL)
	pipeline.SAdd(ctx, diagramActiveUsersKey(connection.DiagramID), connection.Session.UserID.String())
	pipeline.Expire(ctx, diagramActiveUsersKey(connection.DiagramID), redisPresenceTTL)
	_, execErr := pipeline.Exec(ctx)
	return execErr
}

func (hub *Hub) cleanupConnectionState(ctx context.Context, connection *Connection) error {
	pipeline := hub.redis.TxPipeline()
	pipeline.Del(ctx, wsConnectionKey(connection.ID))
	pipeline.SRem(ctx, diagramConnectionsKey(connection.DiagramID), connection.ID)
	pipeline.HDel(ctx, diagramPresenceKey(connection.DiagramID), connection.ID)
	pipeline.Expire(ctx, diagramConnectionsKey(connection.DiagramID), redisPresenceTTL)
	pipeline.Expire(ctx, diagramPresenceKey(connection.DiagramID), redisPresenceTTL)
	if _, execErr := pipeline.Exec(ctx); execErr != nil {
		return execErr
	}

	if removeErr := hub.removeActiveUserIfLastConnection(ctx, connection); removeErr != nil {
		return removeErr
	}

	leave := presenceEnvelope{
		Type:         "presence:leave",
		DiagramID:    connection.DiagramID,
		ConnectionID: connection.ID,
		UserID:       connection.Session.UserID.String(),
		SentAt:       time.Now().UTC(),
	}
	return hub.redis.Publish(ctx, diagramPresenceChannel(connection.DiagramID), encodeJSON(leave)).Err()
}

func (hub *Hub) removeActiveUserIfLastConnection(ctx context.Context, connection *Connection) error {
	values, valuesErr := hub.redis.HVals(ctx, diagramPresenceKey(connection.DiagramID)).Result()
	if valuesErr != nil {
		return valuesErr
	}
	for _, value := range values {
		var presence presenceEnvelope
		if decodeErr := json.Unmarshal([]byte(value), &presence); decodeErr == nil && presence.UserID == connection.Session.UserID.String() {
			return hub.redis.Expire(ctx, diagramActiveUsersKey(connection.DiagramID), redisPresenceTTL).Err()
		}
	}
	pipeline := hub.redis.TxPipeline()
	pipeline.SRem(ctx, diagramActiveUsersKey(connection.DiagramID), connection.Session.UserID.String())
	pipeline.Expire(ctx, diagramActiveUsersKey(connection.DiagramID), redisPresenceTTL)
	_, execErr := pipeline.Exec(ctx)
	return execErr
}

func (hub *Hub) refreshConnectionTTL(connection *Connection) {
	ticker := time.NewTicker(ttlRefreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-connection.done:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), redisOperationTimeout)
			pipeline := hub.redis.TxPipeline()
			pipeline.Expire(ctx, wsConnectionKey(connection.ID), redisPresenceTTL)
			pipeline.Expire(ctx, diagramConnectionsKey(connection.DiagramID), redisPresenceTTL)
			pipeline.Expire(ctx, diagramPresenceKey(connection.DiagramID), redisPresenceTTL)
			pipeline.Expire(ctx, diagramActiveUsersKey(connection.DiagramID), redisPresenceTTL)
			if _, execErr := pipeline.Exec(ctx); execErr != nil && hub.logger != nil {
				hub.logger.Printf("refresh websocket redis ttl for %s: %v", connection.ID, execErr)
			}
			cancel()
		}
	}
}

func (hub *Hub) subscribe(ctx context.Context, diagramID string) {
	pubsub := hub.redis.Subscribe(ctx, diagramUpdatesChannel(diagramID), diagramPresenceChannel(diagramID))
	defer func() { _ = pubsub.Close() }()

	if _, receiveErr := pubsub.Receive(ctx); receiveErr != nil {
		if ctx.Err() == nil && hub.logger != nil {
			hub.logger.Printf("subscribe to diagram %s: %v", diagramID, receiveErr)
		}
		return
	}

	messages := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			switch message.Channel {
			case diagramUpdatesChannel(diagramID):
				hub.handleUpdatePubSub(diagramID, []byte(message.Payload))
			case diagramPresenceChannel(diagramID):
				hub.broadcastText(diagramID, []byte(message.Payload))
			}
		}
	}
}

func (hub *Hub) handleUpdatePubSub(diagramID string, payload []byte) {
	var envelope updateEnvelope
	if decodeErr := json.Unmarshal(payload, &envelope); decodeErr != nil {
		if hub.logger != nil {
			hub.logger.Printf("decode update envelope for %s: %v", diagramID, decodeErr)
		}
		return
	}
	if envelope.OriginInstanceID == hub.instanceID {
		return
	}
	decodedPayload, decodeErr := base64.StdEncoding.DecodeString(envelope.Data)
	if decodeErr != nil {
		if hub.logger != nil {
			hub.logger.Printf("decode update payload for %s: %v", diagramID, decodeErr)
		}
		return
	}
	hub.broadcastBinary(diagramID, decodedPayload, envelope.OriginConnectionID)
}

func (hub *Hub) broadcastBinary(diagramID string, payload []byte, skipConnectionID string) {
	hub.broadcast(diagramID, outboundMessage{messageType: websocket.BinaryMessage, payload: payload}, skipConnectionID)
}

func (hub *Hub) broadcastText(diagramID string, payload []byte) {
	hub.broadcast(diagramID, outboundMessage{messageType: websocket.TextMessage, payload: payload}, "")
}

func (hub *Hub) broadcast(diagramID string, message outboundMessage, skipConnectionID string) {
	hub.mu.RLock()
	currentRoom := hub.rooms[diagramID]
	connections := make([]*Connection, 0)
	if currentRoom != nil {
		for _, connection := range currentRoom.connections {
			if connection.ID != skipConnectionID {
				connections = append(connections, connection)
			}
		}
	}
	hub.mu.RUnlock()

	for _, connection := range connections {
		if !connection.enqueue(message) {
			go func(staleConnection *Connection) {
				cleanupCtx, cancel := context.WithTimeout(context.Background(), staleConnectionTimeout)
				defer cancel()
				hub.Unregister(cleanupCtx, staleConnection)
			}(connection)
		}
	}
}
