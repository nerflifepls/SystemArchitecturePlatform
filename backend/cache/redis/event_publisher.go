package rediscache

import (
	"context"
	"encoding/json"
	"log"

	"backend/domain"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

// EventPublisher fans invalidation events out to authenticated users and to a
// workspace channel consumed by diagram sockets for immediate access changes.
type EventPublisher struct {
	client *goredis.Client
	logger *log.Logger
}

func NewEventPublisher(client *goredis.Client, logger *log.Logger) *EventPublisher {
	return &EventPublisher{client: client, logger: logger}
}

func (publisher *EventPublisher) Publish(ctx context.Context, recipients []uuid.UUID, event domain.LiveEvent) {
	if publisher == nil || publisher.client == nil {
		return
	}

	payload, marshalErr := json.Marshal(event)
	if marshalErr != nil {
		publisher.logFailure(event, marshalErr)
		return
	}

	pipeline := publisher.client.Pipeline()
	seen := make(map[uuid.UUID]struct{}, len(recipients))
	for _, userID := range recipients {
		if userID == uuid.Nil {
			continue
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		seen[userID] = struct{}{}
		pipeline.Publish(ctx, userEventsChannel(userID), payload)
	}
	if event.WorkspaceID != nil && *event.WorkspaceID != uuid.Nil {
		pipeline.Publish(ctx, workspaceEventsChannel(*event.WorkspaceID), payload)
	}

	if _, publishErr := pipeline.Exec(ctx); publishErr != nil {
		publisher.logFailure(event, publishErr)
	}
}

func (publisher *EventPublisher) logFailure(event domain.LiveEvent, err error) {
	if publisher.logger != nil {
		publisher.logger.Printf("publish live event %s (%s): %v", event.Type, event.ID, err)
	}
}

func userEventsChannel(userID uuid.UUID) string {
	return "pubsub:user:" + userID.String() + ":events"
}

func workspaceEventsChannel(workspaceID uuid.UUID) string {
	return "pubsub:workspace:" + workspaceID.String() + ":events"
}
