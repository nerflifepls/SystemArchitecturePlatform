package services

import (
	"context"
	"testing"
	"time"

	"backend/domain"

	"github.com/google/uuid"
)

type diagramRepositoryStub struct {
	DiagramRepository
	diagram       domain.Diagram
	snapshots     []domain.DiagramSnapshot
	savedName     string
	savedReason   string
	saveCallCount int
}

func (stub *diagramRepositoryStub) GetDiagramByID(context.Context, uuid.UUID) (domain.Diagram, error) {
	return stub.diagram, nil
}

func (stub *diagramRepositoryStub) SaveDiagramSnapshot(_ context.Context, _ uuid.UUID, _ []byte, _ int64, _ uuid.UUID, name string, reason string) (domain.Diagram, error) {
	stub.savedName = name
	stub.savedReason = reason
	stub.saveCallCount++
	updated := stub.diagram
	updated.SnapshotVersion++
	updated.UpdatedAt = time.Unix(1_700_000_000, 0).UTC()
	return updated, nil
}

func (stub *diagramRepositoryStub) ListDiagramSnapshots(context.Context, uuid.UUID, int) ([]domain.DiagramSnapshot, error) {
	return stub.snapshots, nil
}

type projectRepositoryStub struct {
	ProjectRepository
	project domain.Project
}

func (stub *projectRepositoryStub) GetProjectByID(context.Context, uuid.UUID) (domain.Project, error) {
	return stub.project, nil
}

type workspaceRepositoryStub struct {
	WorkspaceRepository
	workspace domain.WorkspaceWithRole
}

func (stub *workspaceRepositoryStub) GetWorkspaceForUser(context.Context, uuid.UUID, uuid.UUID) (domain.WorkspaceWithRole, error) {
	return stub.workspace, nil
}

func newDiagramServiceForTest(role domain.Role) (*DiagramService, *diagramRepositoryStub, uuid.UUID, uuid.UUID) {
	diagramID := uuid.New()
	projectID := uuid.New()
	workspaceID := uuid.New()
	diagrams := &diagramRepositoryStub{diagram: domain.Diagram{
		ID:                    diagramID,
		ProjectID:             projectID,
		SnapshotVersion:       3,
		SnapshotBaseUpdateSeq: 7,
		LastUpdateSeq:         9,
	}}
	projects := &projectRepositoryStub{project: domain.Project{ID: projectID, WorkspaceID: workspaceID}}
	workspaces := &workspaceRepositoryStub{workspace: domain.WorkspaceWithRole{ID: workspaceID, Role: role}}
	return NewDiagramService(diagrams, projects, workspaces), diagrams, diagramID, uuid.New()
}

func TestSaveSnapshotRecordsNormalizedMetadata(t *testing.T) {
	service, repository, diagramID, actorID := newDiagramServiceForTest(domain.RoleEditor)
	result, saveErr := service.SaveSnapshot(context.Background(), actorID, diagramID, 9, []byte{1, 2, 3}, "  Thesis baseline  ", "manual")
	if saveErr != nil {
		t.Fatalf("SaveSnapshot returned error: %v", saveErr)
	}
	if repository.savedName != "Thesis baseline" || repository.savedReason != "manual" {
		t.Fatalf("unexpected snapshot metadata: name=%q reason=%q", repository.savedName, repository.savedReason)
	}
	if result.SnapshotVersion != 4 || result.LastUpdateSeq != 9 {
		t.Fatalf("unexpected save result: %+v", result)
	}
}

func TestSaveSnapshotRejectsInvalidReasonBeforeRepositoryWrite(t *testing.T) {
	service, repository, diagramID, actorID := newDiagramServiceForTest(domain.RoleEditor)
	_, saveErr := service.SaveSnapshot(context.Background(), actorID, diagramID, 9, []byte{1}, "", "untrusted")
	if saveErr == nil || saveErr.(*Error).Status != 422 {
		t.Fatalf("expected validation error, got %v", saveErr)
	}
	if repository.saveCallCount != 0 {
		t.Fatal("repository write occurred for invalid metadata")
	}
}

func TestViewerCanReadHistoryButCannotCreateIt(t *testing.T) {
	service, repository, diagramID, actorID := newDiagramServiceForTest(domain.RoleViewer)
	repository.snapshots = []domain.DiagramSnapshot{{DiagramID: diagramID, SnapshotVersion: 3}}

	snapshots, listErr := service.ListSnapshots(context.Background(), actorID, diagramID, 50)
	if listErr != nil || len(snapshots) != 1 {
		t.Fatalf("viewer could not read history: snapshots=%v error=%v", snapshots, listErr)
	}
	_, saveErr := service.SaveSnapshot(context.Background(), actorID, diagramID, 9, []byte{1}, "", "manual")
	if saveErr == nil || saveErr.(*Error).Status != 403 {
		t.Fatalf("expected forbidden error, got %v", saveErr)
	}
}
