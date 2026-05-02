package postgre

import (
	"context"

	"backend/domain"

	"github.com/google/uuid"
)

func (repository *Repository) ListProjects(ctx context.Context, workspaceID uuid.UUID, limit int, cursor string) ([]domain.Project, string, error) {
	rows, queryErr := repository.pool.Query(ctx, `
		select id, workspace_id, name, description, created_by, created_at, updated_at
		from projects
		where workspace_id = $1
		order by updated_at desc, id desc
		limit $2
	`, workspaceID, limit)
	if queryErr != nil {
		return nil, "", mapPostgresError(queryErr)
	}
	defer rows.Close()

	projects := make([]domain.Project, 0)
	for rows.Next() {
		project, scanErr := scanProject(rows)
		if scanErr != nil {
			return nil, "", mapPostgresError(scanErr)
		}
		projects = append(projects, project)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, "", mapPostgresError(rowsErr)
	}
	return projects, "", nil
}

func (repository *Repository) CreateProject(ctx context.Context, workspaceID uuid.UUID, actorUserID uuid.UUID, name string, description *string) (domain.Project, error) {
	projectID := uuid.New()
	row := repository.pool.QueryRow(ctx, `
		insert into projects (id, workspace_id, name, description, created_by)
		values ($1, $2, $3, $4, $5)
		returning id, workspace_id, name, description, created_by, created_at, updated_at
	`, projectID, workspaceID, name, description, actorUserID)
	project, scanErr := scanProject(row)
	if scanErr != nil {
		return domain.Project{}, mapPostgresError(scanErr)
	}
	return project, nil
}

func (repository *Repository) GetProjectByID(ctx context.Context, projectID uuid.UUID) (domain.Project, error) {
	row := repository.pool.QueryRow(ctx, `
		select id, workspace_id, name, description, created_by, created_at, updated_at
		from projects
		where id = $1
	`, projectID)
	project, scanErr := scanProject(row)
	if scanErr != nil {
		return domain.Project{}, mapPostgresError(scanErr)
	}
	return project, nil
}

func (repository *Repository) UpdateProject(ctx context.Context, projectID uuid.UUID, name *string, description *string, descriptionSet bool) (domain.Project, error) {
	row := repository.pool.QueryRow(ctx, `
		update projects
		set name = coalesce($2::text, name),
			description = case when $3::boolean then $4::text else description end,
			updated_at = now()
		where id = $1
		returning id, workspace_id, name, description, created_by, created_at, updated_at
	`, projectID, name, descriptionSet, description)
	project, scanErr := scanProject(row)
	if scanErr != nil {
		return domain.Project{}, mapPostgresError(scanErr)
	}
	return project, nil
}

func (repository *Repository) DeleteProject(ctx context.Context, projectID uuid.UUID) error {
	commandTag, execErr := repository.pool.Exec(ctx, `delete from projects where id = $1`, projectID)
	if execErr != nil {
		return mapPostgresError(execErr)
	}
	if commandTag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
