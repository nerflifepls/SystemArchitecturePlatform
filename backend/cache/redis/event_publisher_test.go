package rediscache

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"backend/domain"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

func TestEventPublisherFansOutToUserAndWorkspaceChannels(t *testing.T) {
	redisServer, serverErr := miniredis.Run()
	if serverErr != nil {
		t.Fatalf("start miniredis: %v", serverErr)
	}
	defer redisServer.Close()

	client := goredis.NewClient(&goredis.Options{Addr: redisServer.Addr()})
	defer func() { _ = client.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	userID := uuid.New()
	workspaceID := uuid.New()
	userSubscription := client.Subscribe(ctx, userEventsChannel(userID))
	workspaceSubscription := client.Subscribe(ctx, workspaceEventsChannel(workspaceID))
	defer func() { _ = userSubscription.Close() }()
	defer func() { _ = workspaceSubscription.Close() }()
	if _, receiveErr := userSubscription.Receive(ctx); receiveErr != nil {
		t.Fatalf("subscribe user channel: %v", receiveErr)
	}
	if _, receiveErr := workspaceSubscription.Receive(ctx); receiveErr != nil {
		t.Fatalf("subscribe workspace channel: %v", receiveErr)
	}

	event := domain.LiveEvent{
		ID:          uuid.New(),
		Type:        "workspace.member.updated",
		OccurredAt:  time.Now().UTC(),
		ActorUserID: uuid.New(),
		WorkspaceID: &workspaceID,
		Role:        domain.RoleViewer,
	}
	NewEventPublisher(client, nil).Publish(ctx, []uuid.UUID{userID, userID}, event)

	for channelName, subscription := range map[string]*goredis.PubSub{
		userEventsChannel(userID):           userSubscription,
		workspaceEventsChannel(workspaceID): workspaceSubscription,
	} {
		message, messageErr := subscription.ReceiveMessage(ctx)
		if messageErr != nil {
			t.Fatalf("receive %s: %v", channelName, messageErr)
		}
		var decoded domain.LiveEvent
		if decodeErr := json.Unmarshal([]byte(message.Payload), &decoded); decodeErr != nil {
			t.Fatalf("decode %s payload: %v", channelName, decodeErr)
		}
		if decoded.ID != event.ID || decoded.Type != event.Type || decoded.Role != domain.RoleViewer {
			t.Fatalf("unexpected %s payload: %+v", channelName, decoded)
		}
	}
}
