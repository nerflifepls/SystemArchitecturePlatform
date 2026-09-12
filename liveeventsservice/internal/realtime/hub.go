package realtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"liveeventsservice/internal/authz"

	"github.com/google/uuid"
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
	authz      *authz.Client
	instanceID string
	logger     *log.Logger

	mu       sync.RWMutex
	rooms    map[string]*room
	closed   bool
	closeAll sync.Once
}

type room struct {
	diagramID    string
	workspaceID  string
	connections  map[string]*Connection
	subscription context.CancelFunc
}

// NewHub creates a realtime hub for one service instance.
func NewHub(redisClient *goredis.Client, authzClient *authz.Client, instanceID string, logger *log.Logger) *Hub {
	return &Hub{
		redis:      redisClient,
		authz:      authzClient,
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
	if hub.closed {
		hub.mu.Unlock()
		_ = hub.cleanupConnectionState(ctx, connection)
		return context.Canceled
	}
	currentRoom := hub.rooms[connection.DiagramID]
	if currentRoom != nil {
		currentRoom.connections[connection.ID] = connection
		hub.mu.Unlock()
		hub.finishRegistration(ctx, connection)
		return nil
	}
	hub.mu.Unlock()

	// Redis subscription setup performs network I/O, so keep it outside the
	// hub-wide lock. A second lock/check below resolves concurrent first joins.
	subscriptionCtx, cancelSubscription, pubsub, receiveErr := openRedisSubscription(
		ctx,
		hub.redis,
		diagramUpdatesChannel(connection.DiagramID),
		diagramPresenceChannel(connection.DiagramID),
		workspaceEventsChannel(connection.WorkspaceID),
	)
	if receiveErr != nil {
		_ = hub.cleanupConnectionState(ctx, connection)
		return receiveErr
	}

	useSubscription := false
	hub.mu.Lock()
	if hub.closed {
		hub.mu.Unlock()
		cancelSubscription()
		_ = pubsub.Close()
		_ = hub.cleanupConnectionState(ctx, connection)
		return context.Canceled
	}
	currentRoom = hub.rooms[connection.DiagramID]
	if currentRoom == nil {
		currentRoom = &room{diagramID: connection.DiagramID, workspaceID: connection.WorkspaceID, connections: make(map[string]*Connection), subscription: cancelSubscription}
		hub.rooms[connection.DiagramID] = currentRoom
		useSubscription = true
	}
	currentRoom.connections[connection.ID] = connection
	hub.mu.Unlock()

	if useSubscription {
		go hub.subscribe(subscriptionCtx, currentRoom, pubsub)
	} else {
		cancelSubscription()
		_ = pubsub.Close()
	}
	hub.finishRegistration(ctx, connection)
	return nil
}

func (hub *Hub) finishRegistration(ctx context.Context, connection *Connection) {
	// Authorization happened before the room subscription existed. Recheck once
	// after subscribing so a permission event published in that small gap cannot
	// leave a stale editor connection active until the periodic check.
	hub.reauthorizeConnection(ctx, connection)
	go hub.refreshConnectionTTL(connection)
}

func openRedisSubscription(ctx context.Context, redisClient *goredis.Client, channels ...string) (context.Context, context.CancelFunc, *goredis.PubSub, error) {
	subscriptionCtx, cancelSubscription := context.WithCancel(context.Background())
	pubsub := redisClient.Subscribe(subscriptionCtx, channels...)
	readyCtx, cancelReady := context.WithTimeout(ctx, redisOperationTimeout)
	_, receiveErr := pubsub.Receive(readyCtx)
	cancelReady()
	if receiveErr != nil {
		cancelSubscription()
		_ = pubsub.Close()
		return nil, nil, nil, receiveErr
	}
	return subscriptionCtx, cancelSubscription, pubsub, nil
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
	connection.roleMu.RLock()
	defer connection.roleMu.RUnlock()
	if !canEditRole(connection.role) {
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
		"project_id":    connection.ProjectID,
		"workspace_id":  connection.WorkspaceID,
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
			hub.reauthorizeConnection(ctx, connection)
			cancel()
		}
	}
}

func (hub *Hub) reauthorizeConnection(ctx context.Context, connection *Connection) {
	if hub.authz == nil {
		return
	}
	connection.authorizationMu.Lock()
	defer connection.authorizationMu.Unlock()
	diagramID, parseErr := uuid.Parse(connection.DiagramID)
	if parseErr != nil {
		return
	}
	authorization, authorizeErr := hub.authz.AuthorizeDiagram(ctx, diagramID, connection.Session.UserID)
	if authorizeErr != nil {
		if errors.Is(authorizeErr, authz.ErrForbidden) {
			connection.revokeAccess()
			enqueued := connection.enqueue(outboundMessage{
				messageType: websocket.TextMessage,
				payload: encodeJSON(accessMessage{
					Type:        "access:revoked",
					Reason:      "authorization_revoked",
					WorkspaceID: connection.WorkspaceID,
					ProjectID:   connection.ProjectID,
					DiagramID:   connection.DiagramID,
				}),
				closeAfter: true,
			})
			if !enqueued && connection.websocket != nil {
				_ = connection.websocket.Close()
			}
		}
		return
	}
	if !validRole(authorization.Role) || authorization.Role == connection.currentRole() {
		return
	}
	if !connection.setRole(authorization.Role) {
		return
	}
	connection.enqueue(outboundMessage{
		messageType: websocket.TextMessage,
		payload: encodeJSON(accessMessage{
			Type:        "access:changed",
			Reason:      "role_changed",
			WorkspaceID: connection.WorkspaceID,
			ProjectID:   connection.ProjectID,
			DiagramID:   connection.DiagramID,
			Role:        authorization.Role,
		}),
	})
}

func (hub *Hub) subscribe(ctx context.Context, currentRoom *room, pubsub *goredis.PubSub) {
	diagramID := currentRoom.diagramID
	workspaceID := currentRoom.workspaceID
	defer func() { _ = pubsub.Close() }()
	defer hub.subscriptionEnded(currentRoom)

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
			case workspaceEventsChannel(workspaceID):
				hub.handleWorkspaceEvent(diagramID, []byte(message.Payload))
			}
		}
	}
}

func (hub *Hub) subscriptionEnded(endedRoom *room) {
	hub.mu.Lock()
	if hub.rooms[endedRoom.diagramID] != endedRoom {
		hub.mu.Unlock()
		return
	}
	delete(hub.rooms, endedRoom.diagramID)
	connections := make([]*Connection, 0, len(endedRoom.connections))
	for _, connection := range endedRoom.connections {
		connections = append(connections, connection)
	}
	hub.mu.Unlock()

	for _, connection := range connections {
		connection.closeSend()
		cleanupCtx, cancel := context.WithTimeout(context.Background(), staleConnectionTimeout)
		if cleanupErr := hub.cleanupConnectionState(cleanupCtx, connection); cleanupErr != nil && hub.logger != nil {
			hub.logger.Printf("cleanup websocket connection %s after subscription ended: %v", connection.ID, cleanupErr)
		}
		cancel()
	}
}

func (hub *Hub) handleWorkspaceEvent(diagramID string, payload []byte) {
	var event liveEvent
	if decodeErr := json.Unmarshal(payload, &event); decodeErr != nil {
		if hub.logger != nil {
			hub.logger.Printf("decode workspace event for diagram %s: %v", diagramID, decodeErr)
		}
		return
	}

	hub.mu.RLock()
	currentRoom := hub.rooms[diagramID]
	connections := make([]*Connection, 0)
	if currentRoom != nil {
		for _, connection := range currentRoom.connections {
			connections = append(connections, connection)
		}
	}
	hub.mu.RUnlock()

	switch event.Type {
	case "workspace.member.updated":
		if event.SubjectUserID == "" || !validRole(event.Role) {
			return
		}
		for _, connection := range connections {
			if connection.Session.UserID.String() != event.SubjectUserID {
				continue
			}
			connection.authorizationMu.Lock()
			if !connection.setRole(event.Role) {
				connection.authorizationMu.Unlock()
				continue
			}
			connection.enqueue(outboundMessage{
				messageType: websocket.TextMessage,
				payload: encodeJSON(accessMessage{
					Type:        "access:changed",
					Reason:      "role_changed",
					WorkspaceID: connection.WorkspaceID,
					ProjectID:   connection.ProjectID,
					DiagramID:   connection.DiagramID,
					Role:        event.Role,
				}),
			})
			connection.authorizationMu.Unlock()
		}
	case "workspace.member.removed":
		hub.revokeMatching(connections, "membership_removed", func(connection *Connection) bool {
			return event.SubjectUserID != "" && connection.Session.UserID.String() == event.SubjectUserID
		})
	case "workspace.deleted":
		hub.revokeMatching(connections, "workspace_deleted", func(*Connection) bool { return true })
	case "project.deleted":
		hub.revokeMatching(connections, "project_deleted", func(connection *Connection) bool {
			return event.ProjectID != "" && connection.ProjectID == event.ProjectID
		})
	case "diagram.deleted":
		hub.revokeMatching(connections, "diagram_deleted", func(connection *Connection) bool {
			return event.DiagramID != "" && connection.DiagramID == event.DiagramID
		})
	}
}

func (hub *Hub) revokeMatching(connections []*Connection, reason string, matches func(*Connection) bool) {
	for _, connection := range connections {
		if !matches(connection) {
			continue
		}
		connection.authorizationMu.Lock()
		connection.revokeAccess()
		enqueued := connection.enqueue(outboundMessage{
			messageType: websocket.TextMessage,
			payload: encodeJSON(accessMessage{
				Type:        "access:revoked",
				Reason:      reason,
				WorkspaceID: connection.WorkspaceID,
				ProjectID:   connection.ProjectID,
				DiagramID:   connection.DiagramID,
			}),
			closeAfter: true,
		})
		connection.authorizationMu.Unlock()
		if !enqueued {
			if connection.websocket != nil {
				_ = connection.websocket.Close()
			}
		}
	}
}

func validRole(role string) bool {
	switch role {
	case "owner", "admin", "editor", "viewer":
		return true
	default:
		return false
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
