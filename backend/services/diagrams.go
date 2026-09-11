package services

import (
	"context"
	"errors"
	"strings"
	"time"

	"backend/domain"

	"github.com/google/uuid"
)

var EmptyYjsSnapshot = []byte{0, 0}

type DiagramRepository interface {
	ListDiagrams(context.Context, uuid.UUID, int, string) ([]domain.Diagram, string, error)
	CreateDiagram(context.Context, uuid.UUID, uuid.UUID, string, []byte) (domain.Diagram, error)
	GetDiagramByID(context.Context, uuid.UUID) (domain.Diagram, error)
	UpdateDiagramTitle(context.Context, uuid.UUID, string) (domain.Diagram, error)
	DeleteDiagram(context.Context, uuid.UUID) error
	SaveDiagramSnapshot(context.Context, uuid.UUID, []byte, int64, uuid.UUID, string, string) (domain.Diagram, error)
	ListDiagramSnapshots(context.Context, uuid.UUID, int) ([]domain.DiagramSnapshot, error)
	GetDiagramSnapshot(context.Context, uuid.UUID, int64) (domain.DiagramSnapshot, error)
	ListDiagramUpdates(context.Context, uuid.UUID, int64) ([]domain.DiagramUpdate, error)
	AppendDiagramUpdate(context.Context, uuid.UUID, uuid.UUID, string, uuid.UUID, []byte) (domain.DiagramUpdate, bool, error)
	GetDiagramAccess(context.Context, uuid.UUID, uuid.UUID) (domain.DiagramAccess, error)
}

type SnapshotSaveResult struct {
	SnapshotVersion int64     `json:"snapshotVersion"`
	LastUpdateSeq   int64     `json:"lastUpdateSeq"`
	SavedAt         time.Time `json:"savedAt"`
}

type DiagramService struct {
	diagrams   DiagramRepository
	projects   ProjectRepository
	workspaces WorkspaceRepository
}

func NewDiagramService(diagrams DiagramRepository, projects ProjectRepository, workspaces WorkspaceRepository) *DiagramService {
	return &DiagramService{diagrams: diagrams, projects: projects, workspaces: workspaces}
}

func (service *DiagramService) ListDiagrams(ctx context.Context, actorUserID uuid.UUID, projectID uuid.UUID, limit int, cursor string) ([]domain.Diagram, string, error) {
	_, _, accessErr := service.requireProjectAccess(ctx, actorUserID, projectID)
	if accessErr != nil {
		return nil, "", accessErr
	}
	diagrams, nextCursor, listErr := service.diagrams.ListDiagrams(ctx, projectID, clampLimit(limit), cursor)
	if listErr != nil {
		return nil, "", mapRepositoryError(listErr, "diagram")
	}
	return diagrams, nextCursor, nil
}

func (service *DiagramService) CreateDiagram(ctx context.Context, actorUserID uuid.UUID, projectID uuid.UUID, title string) (domain.Diagram, error) {
	_, role, accessErr := service.requireProjectAccess(ctx, actorUserID, projectID)
	if accessErr != nil {
		return domain.Diagram{}, accessErr
	}
	if !role.CanEdit() {
		return domain.Diagram{}, Forbidden("editor role is required")
	}
	trimmedTitle, validationErr := validateDiagramTitle(title)
	if validationErr != nil {
		return domain.Diagram{}, validationErr
	}
	diagram, createErr := service.diagrams.CreateDiagram(ctx, projectID, actorUserID, trimmedTitle, EmptyYjsSnapshot)
	if createErr != nil {
		return domain.Diagram{}, mapRepositoryError(createErr, "diagram")
	}
	return diagram, nil
}

func (service *DiagramService) GetDiagram(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID) (domain.Diagram, domain.Role, error) {
	diagram, role, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID)
	if accessErr != nil {
		return domain.Diagram{}, "", accessErr
	}
	return diagram, role, nil
}

func (service *DiagramService) UpdateDiagram(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID, title string) (domain.Diagram, error) {
	_, role, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID)
	if accessErr != nil {
		return domain.Diagram{}, accessErr
	}
	if !role.CanEdit() {
		return domain.Diagram{}, Forbidden("editor role is required")
	}
	trimmedTitle, validationErr := validateDiagramTitle(title)
	if validationErr != nil {
		return domain.Diagram{}, validationErr
	}
	diagram, updateErr := service.diagrams.UpdateDiagramTitle(ctx, diagramID, trimmedTitle)
	if updateErr != nil {
		return domain.Diagram{}, mapRepositoryError(updateErr, "diagram")
	}
	return diagram, nil
}

func (service *DiagramService) DeleteDiagram(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID) error {
	_, role, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID)
	if accessErr != nil {
		return accessErr
	}
	if !role.CanDeleteContent() {
		return Forbidden("owner or admin role is required")
	}
	if deleteErr := service.diagrams.DeleteDiagram(ctx, diagramID); deleteErr != nil {
		return mapRepositoryError(deleteErr, "diagram")
	}
	return nil
}

func (service *DiagramService) GetSnapshot(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID) (domain.Diagram, error) {
	diagram, _, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID)
	if accessErr != nil {
		return domain.Diagram{}, accessErr
	}
	return diagram, nil
}

func (service *DiagramService) SaveSnapshot(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID, baseUpdateSeq int64, snapshotBytes []byte, name string, reason string) (SnapshotSaveResult, error) {
	diagram, role, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID)
	if accessErr != nil {
		return SnapshotSaveResult{}, accessErr
	}
	if !role.CanEdit() {
		return SnapshotSaveResult{}, Forbidden("editor role is required")
	}
	if baseUpdateSeq < diagram.SnapshotBaseUpdateSeq {
		return SnapshotSaveResult{}, Conflict("snapshot base update sequence is older than the current compacted snapshot")
	}
	if baseUpdateSeq > diagram.LastUpdateSeq {
		return SnapshotSaveResult{}, Validation("snapshot base update sequence is newer than the latest persisted update", map[string]string{"X-Base-Update-Seq": "too_new"})
	}
	if len(snapshotBytes) == 0 {
		return SnapshotSaveResult{}, Validation("snapshot body is required", map[string]string{"body": "required"})
	}
	trimmedName := strings.TrimSpace(name)
	if len(trimmedName) > 120 {
		return SnapshotSaveResult{}, Validation("snapshot name must not exceed 120 characters", map[string]string{"X-Snapshot-Name": "max_120"})
	}
	if reason == "" {
		reason = "automatic"
	}
	switch reason {
	case "automatic", "manual", "restore", "import":
	default:
		return SnapshotSaveResult{}, Validation("snapshot reason is invalid", map[string]string{"X-Snapshot-Reason": "invalid"})
	}
	updatedDiagram, saveErr := service.diagrams.SaveDiagramSnapshot(ctx, diagramID, snapshotBytes, baseUpdateSeq, actorUserID, trimmedName, reason)
	if saveErr != nil {
		if errors.Is(saveErr, domain.ErrConflict) {
			return SnapshotSaveResult{}, Conflict("snapshot base update sequence is older than the current compacted snapshot")
		}
		return SnapshotSaveResult{}, mapRepositoryError(saveErr, "diagram snapshot")
	}
	return SnapshotSaveResult{SnapshotVersion: updatedDiagram.SnapshotVersion, LastUpdateSeq: updatedDiagram.LastUpdateSeq, SavedAt: updatedDiagram.UpdatedAt}, nil
}

func (service *DiagramService) ListSnapshots(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID, limit int) ([]domain.DiagramSnapshot, error) {
	if _, _, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID); accessErr != nil {
		return nil, accessErr
	}
	snapshots, listErr := service.diagrams.ListDiagramSnapshots(ctx, diagramID, clampLimit(limit))
	if listErr != nil {
		return nil, mapRepositoryError(listErr, "diagram snapshots")
	}
	return snapshots, nil
}

func (service *DiagramService) GetSnapshotVersion(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID, snapshotVersion int64) (domain.DiagramSnapshot, error) {
	if _, _, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID); accessErr != nil {
		return domain.DiagramSnapshot{}, accessErr
	}
	if snapshotVersion < 1 {
		return domain.DiagramSnapshot{}, BadRequest("snapshotVersion must be a positive integer")
	}
	snapshot, getErr := service.diagrams.GetDiagramSnapshot(ctx, diagramID, snapshotVersion)
	if getErr != nil {
		return domain.DiagramSnapshot{}, mapRepositoryError(getErr, "diagram snapshot")
	}
	return snapshot, nil
}

func (service *DiagramService) ListUpdates(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID, afterSeq int64) ([]domain.DiagramUpdate, int64, int64, error) {
	diagram, _, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID)
	if accessErr != nil {
		return nil, 0, 0, accessErr
	}
	if afterSeq < 0 {
		afterSeq = diagram.SnapshotBaseUpdateSeq
	} else if afterSeq < diagram.SnapshotBaseUpdateSeq {
		return nil, 0, 0, Conflict("update sequence is older than the compacted snapshot; reload the diagram snapshot")
	}
	updates, listErr := service.diagrams.ListDiagramUpdates(ctx, diagramID, afterSeq)
	if listErr != nil {
		return nil, 0, 0, mapRepositoryError(listErr, "diagram updates")
	}
	return updates, diagram.SnapshotBaseUpdateSeq, diagram.LastUpdateSeq, nil
}

func (service *DiagramService) AppendUpdate(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID, updateID uuid.UUID, clientID string, updateBytes []byte) (domain.DiagramUpdate, bool, error) {
	_, role, accessErr := service.requireDiagramAccess(ctx, actorUserID, diagramID)
	if accessErr != nil {
		return domain.DiagramUpdate{}, false, accessErr
	}
	if !role.CanEdit() {
		return domain.DiagramUpdate{}, false, Forbidden("editor role is required")
	}
	trimmedClientID := strings.TrimSpace(clientID)
	if trimmedClientID == "" || len(trimmedClientID) > 200 {
		return domain.DiagramUpdate{}, false, Validation("X-Client-Id is required", map[string]string{"X-Client-Id": "required"})
	}
	if len(updateBytes) == 0 {
		return domain.DiagramUpdate{}, false, Validation("update body is required", map[string]string{"body": "required"})
	}
	update, duplicate, appendErr := service.diagrams.AppendDiagramUpdate(ctx, diagramID, updateID, trimmedClientID, actorUserID, updateBytes)
	if appendErr != nil {
		return domain.DiagramUpdate{}, false, mapRepositoryError(appendErr, "diagram update")
	}
	return update, duplicate, nil
}

func (service *DiagramService) AuthorizeInternal(ctx context.Context, diagramID uuid.UUID, userID uuid.UUID) (domain.DiagramAccess, error) {
	if service == nil || service.diagrams == nil {
		return domain.DiagramAccess{}, Unavailable("diagram persistence is not configured")
	}
	access, accessErr := service.diagrams.GetDiagramAccess(ctx, diagramID, userID)
	if accessErr != nil {
		if errors.Is(accessErr, domain.ErrNotFound) {
			return domain.DiagramAccess{}, Forbidden("user is not authorized for this diagram")
		}
		return domain.DiagramAccess{}, mapRepositoryError(accessErr, "diagram authorization")
	}
	access.Allowed = true
	return access, nil
}

func (service *DiagramService) requireDiagramAccess(ctx context.Context, actorUserID uuid.UUID, diagramID uuid.UUID) (domain.Diagram, domain.Role, error) {
	if service == nil || service.diagrams == nil || service.projects == nil {
		return domain.Diagram{}, "", Unavailable("diagram persistence is not configured")
	}
	diagram, getErr := service.diagrams.GetDiagramByID(ctx, diagramID)
	if getErr != nil {
		return domain.Diagram{}, "", mapRepositoryError(getErr, "diagram")
	}
	_, role, accessErr := service.requireProjectAccess(ctx, actorUserID, diagram.ProjectID)
	if accessErr != nil {
		return domain.Diagram{}, "", accessErr
	}
	return diagram, role, nil
}

func (service *DiagramService) requireProjectAccess(ctx context.Context, actorUserID uuid.UUID, projectID uuid.UUID) (domain.Project, domain.Role, error) {
	if service == nil || service.projects == nil || service.workspaces == nil {
		return domain.Project{}, "", Unavailable("diagram persistence is not configured")
	}
	project, getErr := service.projects.GetProjectByID(ctx, projectID)
	if getErr != nil {
		return domain.Project{}, "", mapRepositoryError(getErr, "project")
	}
	workspace, accessErr := service.workspaces.GetWorkspaceForUser(ctx, project.WorkspaceID, actorUserID)
	if accessErr != nil {
		return domain.Project{}, "", mapRepositoryError(accessErr, "workspace")
	}
	return project, workspace.Role, nil
}

func validateDiagramTitle(title string) (string, error) {
	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" || len(trimmedTitle) > 160 {
		return "", Validation("diagram title must be between 1 and 160 characters", map[string]string{"title": "1..160"})
	}
	return trimmedTitle, nil
}
