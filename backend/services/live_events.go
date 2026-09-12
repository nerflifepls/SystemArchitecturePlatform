package services

import (
	"context"
	"time"

	"backend/domain"

	"github.com/google/uuid"
)

const (
	EventWorkspaceCreated       = "workspace.created"
	EventWorkspaceUpdated       = "workspace.updated"
	EventWorkspaceDeleted       = "workspace.deleted"
	EventWorkspaceMemberAdded   = "workspace.member.added"
	EventWorkspaceMemberUpdated = "workspace.member.updated"
	EventWorkspaceMemberRemoved = "workspace.member.removed"
	EventProjectCreated         = "project.created"
	EventProjectUpdated         = "project.updated"
	EventProjectDeleted         = "project.deleted"
	EventDiagramCreated         = "diagram.created"
	EventDiagramUpdated         = "diagram.updated"
	EventDiagramDeleted         = "diagram.deleted"
	EventDiagramSnapshotSaved   = "diagram.snapshot.saved"
)

// LiveEventPublisher broadcasts successful mutations. Publishing is deliberately
// best effort: a Redis outage must not turn an already-committed database write
// into a failed HTTP response. Clients refetch all active resource queries after
// reconnecting, which repairs any invalidations missed while disconnected.
type LiveEventPublisher interface {
	Publish(context.Context, []uuid.UUID, domain.LiveEvent)
}

func newLiveEvent(eventType string, actorUserID uuid.UUID, workspaceID *uuid.UUID) domain.LiveEvent {
	return domain.LiveEvent{
		ID:          uuid.New(),
		Type:        eventType,
		OccurredAt:  time.Now().UTC(),
		ActorUserID: actorUserID,
		WorkspaceID: workspaceID,
	}
}

func memberUserIDs(members []domain.WorkspaceMember, fallback ...uuid.UUID) []uuid.UUID {
	unique := make(map[uuid.UUID]struct{}, len(members)+len(fallback))
	for _, member := range members {
		unique[member.User.ID] = struct{}{}
	}
	for _, userID := range fallback {
		if userID != uuid.Nil {
			unique[userID] = struct{}{}
		}
	}

	userIDs := make([]uuid.UUID, 0, len(unique))
	for userID := range unique {
		userIDs = append(userIDs, userID)
	}
	return userIDs
}

func publishWorkspaceEvent(
	ctx context.Context,
	publisher LiveEventPublisher,
	workspaces WorkspaceRepository,
	workspaceID uuid.UUID,
	event domain.LiveEvent,
	fallback ...uuid.UUID,
) {
	if publisher == nil {
		return
	}

	var members []domain.WorkspaceMember
	if workspaces != nil {
		members, _ = workspaces.ListWorkspaceMembers(ctx, workspaceID)
	}
	publisher.Publish(ctx, memberUserIDs(members, fallback...), event)
}
