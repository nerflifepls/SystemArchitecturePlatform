package services

import (
	"context"
	"strings"

	"backend/domain"

	"github.com/google/uuid"
)

type ProjectRepository interface {
	ListProjects(context.Context, uuid.UUID, int, string) ([]domain.Project, string, error)
	CreateProject(context.Context, uuid.UUID, uuid.UUID, string, *string) (domain.Project, error)
	GetProjectByID(context.Context, uuid.UUID) (domain.Project, error)
	UpdateProject(context.Context, uuid.UUID, *string, *string, bool) (domain.Project, error)
	DeleteProject(context.Context, uuid.UUID) error
}

type ProjectPatch struct {
	Name           *string
	Description    *string
	DescriptionSet bool
}

type ProjectService struct {
	projects   ProjectRepository
	workspaces WorkspaceRepository
	events     LiveEventPublisher
}

func NewProjectService(projects ProjectRepository, workspaces WorkspaceRepository, events LiveEventPublisher) *ProjectService {
	return &ProjectService{projects: projects, workspaces: workspaces, events: events}
}

func (service *ProjectService) ListProjects(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID, limit int, cursor string) ([]domain.Project, string, error) {
	if _, accessErr := service.requireWorkspaceAccess(ctx, actorUserID, workspaceID); accessErr != nil {
		return nil, "", accessErr
	}
	projects, nextCursor, listErr := service.projects.ListProjects(ctx, workspaceID, clampLimit(limit), cursor)
	if listErr != nil {
		return nil, "", mapRepositoryError(listErr, "project")
	}
	return projects, nextCursor, nil
}

func (service *ProjectService) CreateProject(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID, name string, description *string) (domain.Project, error) {
	workspace, accessErr := service.requireWorkspaceAccess(ctx, actorUserID, workspaceID)
	if accessErr != nil {
		return domain.Project{}, accessErr
	}
	if !workspace.Role.CanEdit() {
		return domain.Project{}, Forbidden("editor role is required")
	}
	trimmedName, validationErr := validateProjectName(name)
	if validationErr != nil {
		return domain.Project{}, validationErr
	}
	trimmedDescription, descriptionErr := normalizeDescription(description)
	if descriptionErr != nil {
		return domain.Project{}, descriptionErr
	}
	project, createErr := service.projects.CreateProject(ctx, workspaceID, actorUserID, trimmedName, trimmedDescription)
	if createErr != nil {
		return domain.Project{}, mapRepositoryError(createErr, "project")
	}
	event := newLiveEvent(EventProjectCreated, actorUserID, &workspaceID)
	event.ProjectID = &project.ID
	publishWorkspaceEvent(ctx, service.events, service.workspaces, workspaceID, event, actorUserID)
	return project, nil
}

func (service *ProjectService) GetProject(ctx context.Context, actorUserID uuid.UUID, projectID uuid.UUID) (domain.Project, error) {
	project, _, accessErr := service.requireProjectAccess(ctx, actorUserID, projectID)
	if accessErr != nil {
		return domain.Project{}, accessErr
	}
	return project, nil
}

func (service *ProjectService) UpdateProject(ctx context.Context, actorUserID uuid.UUID, projectID uuid.UUID, patch ProjectPatch) (domain.Project, error) {
	project, role, accessErr := service.requireProjectAccess(ctx, actorUserID, projectID)
	if accessErr != nil {
		return domain.Project{}, accessErr
	}
	if !role.CanEdit() {
		return domain.Project{}, Forbidden("editor role is required")
	}

	var name *string
	if patch.Name != nil {
		trimmedName, validationErr := validateProjectName(*patch.Name)
		if validationErr != nil {
			return domain.Project{}, validationErr
		}
		name = &trimmedName
	}
	var description *string
	if patch.DescriptionSet {
		trimmedDescription, descriptionErr := normalizeDescription(patch.Description)
		if descriptionErr != nil {
			return domain.Project{}, descriptionErr
		}
		description = trimmedDescription
	}
	if name == nil && !patch.DescriptionSet {
		return project, nil
	}
	updatedProject, updateErr := service.projects.UpdateProject(ctx, projectID, name, description, patch.DescriptionSet)
	if updateErr != nil {
		return domain.Project{}, mapRepositoryError(updateErr, "project")
	}
	event := newLiveEvent(EventProjectUpdated, actorUserID, &project.WorkspaceID)
	event.ProjectID = &projectID
	publishWorkspaceEvent(ctx, service.events, service.workspaces, project.WorkspaceID, event, actorUserID)
	return updatedProject, nil
}

func (service *ProjectService) DeleteProject(ctx context.Context, actorUserID uuid.UUID, projectID uuid.UUID) error {
	project, role, accessErr := service.requireProjectAccess(ctx, actorUserID, projectID)
	if accessErr != nil {
		return accessErr
	}
	if !role.CanDeleteContent() {
		return Forbidden("owner or admin role is required")
	}
	if deleteErr := service.projects.DeleteProject(ctx, projectID); deleteErr != nil {
		return mapRepositoryError(deleteErr, "project")
	}
	event := newLiveEvent(EventProjectDeleted, actorUserID, &project.WorkspaceID)
	event.ProjectID = &projectID
	publishWorkspaceEvent(ctx, service.events, service.workspaces, project.WorkspaceID, event, actorUserID)
	return nil
}

func (service *ProjectService) requireProjectAccess(ctx context.Context, actorUserID uuid.UUID, projectID uuid.UUID) (domain.Project, domain.Role, error) {
	if service == nil || service.projects == nil || service.workspaces == nil {
		return domain.Project{}, "", Unavailable("project persistence is not configured")
	}
	project, getErr := service.projects.GetProjectByID(ctx, projectID)
	if getErr != nil {
		return domain.Project{}, "", mapRepositoryError(getErr, "project")
	}
	workspace, accessErr := service.requireWorkspaceAccess(ctx, actorUserID, project.WorkspaceID)
	if accessErr != nil {
		return domain.Project{}, "", accessErr
	}
	return project, workspace.Role, nil
}

func (service *ProjectService) requireWorkspaceAccess(ctx context.Context, actorUserID uuid.UUID, workspaceID uuid.UUID) (domain.WorkspaceWithRole, error) {
	if service == nil || service.workspaces == nil || service.projects == nil {
		return domain.WorkspaceWithRole{}, Unavailable("project persistence is not configured")
	}
	workspace, getErr := service.workspaces.GetWorkspaceForUser(ctx, workspaceID, actorUserID)
	if getErr != nil {
		return domain.WorkspaceWithRole{}, mapRepositoryError(getErr, "workspace")
	}
	return workspace, nil
}

func validateProjectName(name string) (string, error) {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == "" || len(trimmedName) > 160 {
		return "", Validation("project name must be between 1 and 160 characters", map[string]string{"name": "1..160"})
	}
	return trimmedName, nil
}

func normalizeDescription(description *string) (*string, error) {
	if description == nil {
		return nil, nil
	}
	trimmedDescription := strings.TrimSpace(*description)
	if len(trimmedDescription) > 2000 {
		return nil, Validation("description must be 2000 characters or fewer", map[string]string{"description": "max 2000"})
	}
	if trimmedDescription == "" {
		return nil, nil
	}
	return &trimmedDescription, nil
}
