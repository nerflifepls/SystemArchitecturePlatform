package realtime

import (
	"context"
	"log"
	"sync"

	"github.com/gorilla/websocket"
	goredis "github.com/redis/go-redis/v9"
)

// EventHub relays Redis invalidation events to every browser connection for a
// user. One Redis subscription is shared by all tabs for that user per service
// instance.
type EventHub struct {
	redis  *goredis.Client
	logger *log.Logger

	mu       sync.RWMutex
	rooms    map[string]*eventRoom
	closed   bool
	closeAll sync.Once
}

type eventRoom struct {
	userID       string
	connections  map[string]*EventConnection
	subscription context.CancelFunc
}

func NewEventHub(redisClient *goredis.Client, logger *log.Logger) *EventHub {
	return &EventHub{redis: redisClient, logger: logger, rooms: make(map[string]*eventRoom)}
}

func (hub *EventHub) Register(ctx context.Context, connection *EventConnection) error {
	userID := connection.Session.UserID.String()

	hub.mu.Lock()
	if hub.closed {
		hub.mu.Unlock()
		return context.Canceled
	}
	currentRoom := hub.rooms[userID]
	if currentRoom != nil {
		currentRoom.connections[connection.ID] = connection
		hub.mu.Unlock()
		return nil
	}
	hub.mu.Unlock()

	subscriptionCtx, cancelSubscription, pubsub, receiveErr := openRedisSubscription(ctx, hub.redis, userEventsChannel(userID))
	if receiveErr != nil {
		return receiveErr
	}

	useSubscription := false
	hub.mu.Lock()
	if hub.closed {
		hub.mu.Unlock()
		cancelSubscription()
		_ = pubsub.Close()
		return context.Canceled
	}
	currentRoom = hub.rooms[userID]
	if currentRoom == nil {
		currentRoom = &eventRoom{userID: userID, connections: make(map[string]*EventConnection), subscription: cancelSubscription}
		hub.rooms[userID] = currentRoom
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
	return nil
}

func (hub *EventHub) Unregister(connection *EventConnection) {
	userID := connection.Session.UserID.String()
	removed := false

	hub.mu.Lock()
	currentRoom := hub.rooms[userID]
	if currentRoom != nil {
		if _, exists := currentRoom.connections[connection.ID]; exists {
			delete(currentRoom.connections, connection.ID)
			removed = true
		}
		if len(currentRoom.connections) == 0 {
			currentRoom.subscription()
			delete(hub.rooms, userID)
		}
	}
	hub.mu.Unlock()

	if removed {
		connection.closeSend()
	}
}

func (hub *EventHub) Close() {
	hub.closeAll.Do(func() {
		hub.mu.Lock()
		hub.closed = true
		connections := make([]*EventConnection, 0)
		for userID, currentRoom := range hub.rooms {
			currentRoom.subscription()
			for _, connection := range currentRoom.connections {
				connections = append(connections, connection)
			}
			delete(hub.rooms, userID)
		}
		hub.mu.Unlock()

		for _, connection := range connections {
			connection.closeSend()
		}
	})
}

func (hub *EventHub) subscribe(ctx context.Context, currentRoom *eventRoom, pubsub *goredis.PubSub) {
	defer func() { _ = pubsub.Close() }()
	defer hub.subscriptionEnded(currentRoom)

	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-pubsub.Channel():
			if !ok {
				return
			}
			hub.broadcast(currentRoom.userID, []byte(message.Payload))
		}
	}
}

func (hub *EventHub) subscriptionEnded(endedRoom *eventRoom) {
	hub.mu.Lock()
	if hub.rooms[endedRoom.userID] != endedRoom {
		hub.mu.Unlock()
		return
	}
	delete(hub.rooms, endedRoom.userID)
	connections := make([]*EventConnection, 0, len(endedRoom.connections))
	for _, connection := range endedRoom.connections {
		connections = append(connections, connection)
	}
	hub.mu.Unlock()

	for _, connection := range connections {
		connection.closeSend()
	}
}

func (hub *EventHub) broadcast(userID string, payload []byte) {
	hub.mu.RLock()
	currentRoom := hub.rooms[userID]
	connections := make([]*EventConnection, 0)
	if currentRoom != nil {
		for _, connection := range currentRoom.connections {
			connections = append(connections, connection)
		}
	}
	hub.mu.RUnlock()

	message := outboundMessage{messageType: websocket.TextMessage, payload: payload}
	for _, connection := range connections {
		if !connection.enqueue(message) {
			go hub.Unregister(connection)
		}
	}
}
