package services

import (
	"context"
	"errors"
	"strings"

	"backend/domain"

	"github.com/google/uuid"
)

type WorkspaceRepository interface {
	ListWorkspacesForUser(context.Context, uuid.UUID, int, string) ([]domain.WorkspaceWithRole, string, error)
	CreateWorkspaceWithOwner(context.Context, uuid.UUID, string) (domain.WorkspaceWithRole, error)
	GetWorkspaceForUser(context.Context, uuid.UUID, uuid.UUID) (domain.WorkspaceWithRole, error)
	UpdateWorkspace(context.Context, uuid.UUID, string) (domain.Workspace, error)
	DeleteWorkspace(context.Context, uuid.UUID) error
	ListWorkspaceMembers(context.Context, uuid.UUID) ([]domain.WorkspaceMember, error)
	AddWorkspaceMember(context.Context, uuid.UUID, uuid.UUID, domain.Role) (domain.WorkspaceMember, error)
	UpdateWorkspaceMember(context.Context, uuid.UUID, uuid.UUID, domain.Role) (domain.WorkspaceMember, error)
	RemoveWorkspaceMember(context.Context, uuid.UUID, uuid.UUID) error
	CountWorkspaceOwners(context.Context, uuid.UUID) (int, error)
}

type WorkspaceService struct {
	workspaces WorkspaceRepository
	users      UserRepository
	events     LiveEventPublisher
}

func NewWorkspaceService(workspaces WorkspaceRepository, users UserRepository, events LiveEventPublisher) *WorkspaceService {
	return &WorkspaceService{workspaces: workspaces, users: users, events: events}
}

func (service *WorkspaceService) ListWorkspaces(ctx context.Context, actorUserID uuid.UUID, limit int, cursor string) ([]domain.WorkspaceWithRole, string, error) {
	if service == nil || service.workspaces == nil {
		return nil, "", Unavailable("workspace persistence is not configured")
	}
	items, nextCursor, listErr := service.workspaces.ListWorkspacesForUser(ctx, actorUserID, clampLimit(limit), cursor)
	if listErr != nil {
		return nil, "", mapRepositoryError(listErr, "workspace")
	}
	return items, nextCursor, nil
}

func (service *WorkspaceService) CreateWorkspace(ctx context.Context, actorUserID uuid.UUID, name string) (domain.WorkspaceWithRole, error) {
	if service == nil || service.workspaces == nil {
		return domain.WorkspaceWithRole{}, Unavailable("workspace persistence is not configured")
	}
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" || len(trimmedName) > 120 {
		return domain.WorkspaceWithRole{}, Validation("workspace name must be between 1 and 120 characters", map[string]string{"name": "1..120"})
	}
	workspace, createErr := service.workspaces.CreateWorkspaceWithOwner(ctx, actorUserID, trimmedName)
	if createErr != nil {
		return domain.WorkspaceWithRole{}, mapRepositoryError(createErr, "workspace")
	}
	event := newLiveEvent(EventWorkspaceCreated, actorUserID, &workspace.ID)
	service.eventsPublish(ctx, []uuid.UUID{actorUserID}, event)
	return workspace, nil
}

func (service *WorkspaceService) GetWorkspace(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID) (domain.WorkspaceWithRole, error) {
	workspace, accessErr := service.requireWorkspaceRole(ctx, actorUserID, workspaceID)
	if accessErr != nil {
		return domain.WorkspaceWithRole{}, accessErr
	}
	return workspace, nil
}

func (service *WorkspaceService) UpdateWorkspace(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID, name string) (domain.WorkspaceWithRole, error) {
	workspace, accessErr := service.requireWorkspaceRole(ctx, actorUserID, workspaceID)
	if accessErr != nil {
		return domain.WorkspaceWithRole{}, accessErr
	}
	if !workspace.Role.CanManageWorkspace() {
		return domain.WorkspaceWithRole{}, Forbidden("owner or admin role is required")
	}
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" || len(trimmedName) > 120 {
		return domain.WorkspaceWithRole{}, Validation("workspace name must be between 1 and 120 characters", map[string]string{"name": "1..120"})
	}
	updatedWorkspace, updateErr := service.workspaces.UpdateWorkspace(ctx, workspaceID, trimmedName)
	if updateErr != nil {
		return domain.WorkspaceWithRole{}, mapRepositoryError(updateErr, "workspace")
	}
	result := domain.WorkspaceWithRole{ID: updatedWorkspace.ID, Name: updatedWorkspace.Name, Role: workspace.Role, CreatedAt: updatedWorkspace.CreatedAt, UpdatedAt: updatedWorkspace.UpdatedAt}
	event := newLiveEvent(EventWorkspaceUpdated, actorUserID, &workspaceID)
	publishWorkspaceEvent(ctx, service.events, service.workspaces, workspaceID, event, actorUserID)
	return result, nil
}

func (service *WorkspaceService) DeleteWorkspace(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID) error {
	workspace, accessErr := service.requireWorkspaceRole(ctx, actorUserID, workspaceID)
	if accessErr != nil {
		return accessErr
	}
	if workspace.Role != domain.RoleOwner {
		return Forbidden("owner role is required")
	}
	members, _ := service.workspaces.ListWorkspaceMembers(ctx, workspaceID)
	if deleteErr := service.workspaces.DeleteWorkspace(ctx, workspaceID); deleteErr != nil {
		return mapRepositoryError(deleteErr, "workspace")
	}
	event := newLiveEvent(EventWorkspaceDeleted, actorUserID, &workspaceID)
	service.eventsPublish(ctx, memberUserIDs(members, actorUserID), event)
	return nil
}

func (service *WorkspaceService) ListMembers(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID) ([]domain.WorkspaceMember, error) {
	if _, accessErr := service.requireWorkspaceRole(ctx, actorUserID, workspaceID); accessErr != nil {
		return nil, accessErr
	}
	members, listErr := service.workspaces.ListWorkspaceMembers(ctx, workspaceID)
	if listErr != nil {
		return nil, mapRepositoryError(listErr, "workspace members")
	}
	return members, nil
}

func (service *WorkspaceService) AddMember(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID, email string, role domain.Role) (domain.WorkspaceMember, error) {
	workspace, accessErr := service.requireWorkspaceRole(ctx, actorUserID, workspaceID)
	if accessErr != nil {
		return domain.WorkspaceMember{}, accessErr
	}
	if !workspace.Role.CanManageWorkspace() {
		return domain.WorkspaceMember{}, Forbidden("owner or admin role is required")
	}
	if service.users == nil {
		return domain.WorkspaceMember{}, Unavailable("user persistence is not configured")
	}
	if role != domain.RoleAdmin && role != domain.RoleEditor && role != domain.RoleViewer {
		return domain.WorkspaceMember{}, Validation("member role must be admin, editor, or viewer", map[string]string{"role": "admin|editor|viewer"})
	}
	trimmedEmail := strings.ToLower(strings.TrimSpace(email))
	if trimmedEmail == "" {
		return domain.WorkspaceMember{}, Validation("email is required", map[string]string{"email": "required"})
	}
	targetUser, userErr := service.users.GetUserByEmail(ctx, trimmedEmail)
	if userErr != nil {
		return domain.WorkspaceMember{}, mapRepositoryError(userErr, "user")
	}
	member, addErr := service.workspaces.AddWorkspaceMember(ctx, workspaceID, targetUser.ID, role)
	if addErr != nil {
		return domain.WorkspaceMember{}, mapRepositoryError(addErr, "workspace member")
	}
	event := newLiveEvent(EventWorkspaceMemberAdded, actorUserID, &workspaceID)
	event.SubjectUserID = &targetUser.ID
	event.Role = role
	publishWorkspaceEvent(ctx, service.events, service.workspaces, workspaceID, event, actorUserID, targetUser.ID)
	return member, nil
}

func (service *WorkspaceService) UpdateMember(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID, targetUserID uuid.UUID, role domain.Role) (domain.WorkspaceMember, error) {
	workspace, accessErr := service.requireWorkspaceRole(ctx, actorUserID, workspaceID)
	if accessErr != nil {
		return domain.WorkspaceMember{}, accessErr
	}
	if !workspace.Role.CanManageWorkspace() {
		return domain.WorkspaceMember{}, Forbidden("owner or admin role is required")
	}
	if !role.Valid() {
		return domain.WorkspaceMember{}, Validation("member role is invalid", map[string]string{"role": "owner|admin|editor|viewer"})
	}
	if role != domain.RoleOwner {
		members, membersErr := service.workspaces.ListWorkspaceMembers(ctx, workspaceID)
		if membersErr != nil {
			return domain.WorkspaceMember{}, mapRepositoryError(membersErr, "workspace members")
		}
		ownerCount := 0
		targetIsOwner := false
		for _, member := range members {
			if member.Role == domain.RoleOwner {
				ownerCount++
			}
			if member.User.ID == targetUserID && member.Role == domain.RoleOwner {
				targetIsOwner = true
			}
		}
		if targetIsOwner && ownerCount <= 1 {
			return domain.WorkspaceMember{}, Conflict("cannot demote the last owner")
		}
	}
	member, updateErr := service.workspaces.UpdateWorkspaceMember(ctx, workspaceID, targetUserID, role)
	if updateErr != nil {
		return domain.WorkspaceMember{}, mapRepositoryError(updateErr, "workspace member")
	}
	event := newLiveEvent(EventWorkspaceMemberUpdated, actorUserID, &workspaceID)
	event.SubjectUserID = &targetUserID
	event.Role = role
	publishWorkspaceEvent(ctx, service.events, service.workspaces, workspaceID, event, actorUserID, targetUserID)
	return member, nil
}

func (service *WorkspaceService) RemoveMember(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID, targetUserID uuid.UUID) error {
	workspace, accessErr := service.requireWorkspaceRole(ctx, actorUserID, workspaceID)
	if accessErr != nil {
		return accessErr
	}
	if actorUserID != targetUserID && !workspace.Role.CanManageWorkspace() {
		return Forbidden("owner or admin role is required")
	}

	members, membersErr := service.workspaces.ListWorkspaceMembers(ctx, workspaceID)
	if membersErr != nil {
		return mapRepositoryError(membersErr, "workspace members")
	}
	ownerCount := 0
	targetIsOwner := false
	for _, member := range members {
		if member.Role == domain.RoleOwner {
			ownerCount++
		}
		if member.User.ID == targetUserID && member.Role == domain.RoleOwner {
			targetIsOwner = true
		}
	}
	if targetIsOwner && ownerCount <= 1 {
		return Conflict("cannot remove the last owner")
	}
	if removeErr := service.workspaces.RemoveWorkspaceMember(ctx, workspaceID, targetUserID); removeErr != nil {
		return mapRepositoryError(removeErr, "workspace member")
	}
	event := newLiveEvent(EventWorkspaceMemberRemoved, actorUserID, &workspaceID)
	event.SubjectUserID = &targetUserID
	service.eventsPublish(ctx, memberUserIDs(members, actorUserID, targetUserID), event)
	return nil
}

func (service *WorkspaceService) eventsPublish(ctx context.Context, recipients []uuid.UUID, event domain.LiveEvent) {
	if service.events != nil {
		service.events.Publish(ctx, recipients, event)
	}
}

func (service *WorkspaceService) requireWorkspaceRole(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID) (domain.WorkspaceWithRole, error) {
	if service == nil || service.workspaces == nil {
		return domain.WorkspaceWithRole{}, Unavailable("workspace persistence is not configured")
	}
	workspace, getErr := service.workspaces.GetWorkspaceForUser(ctx, workspaceID, actorUserID)
	if getErr != nil {
		if errors.Is(getErr, domain.ErrNotFound) {
			return domain.WorkspaceWithRole{}, NotFound("workspace not found")
		}
		return domain.WorkspaceWithRole{}, mapRepositoryError(getErr, "workspace")
	}
	return workspace, nil
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 100 {
		return 100
	}
	return limit
}
