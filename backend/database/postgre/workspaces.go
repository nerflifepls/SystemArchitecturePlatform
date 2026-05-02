package postgre

import (
	"context"

	"backend/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (repository *Repository) ListWorkspacesForUser(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.WorkspaceWithRole, string, error) {
	rows, queryErr := repository.pool.Query(ctx, `
		select w.id, w.name, wm.role, w.created_at, w.updated_at
		from workspaces w
		join workspace_members wm on wm.workspace_id = w.id
		where wm.user_id = $1
		order by w.updated_at desc, w.id desc
		limit $2
	`, userID, limit)
	if queryErr != nil {
		return nil, "", mapPostgresError(queryErr)
	}
	defer rows.Close()

	workspaces := make([]domain.WorkspaceWithRole, 0)
	for rows.Next() {
		var workspace domain.WorkspaceWithRole
		var role string
		if scanErr := rows.Scan(&workspace.ID, &workspace.Name, &role, &workspace.CreatedAt, &workspace.UpdatedAt); scanErr != nil {
			return nil, "", mapPostgresError(scanErr)
		}
		workspace.Role = domain.Role(role)
		workspaces = append(workspaces, workspace)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, "", mapPostgresError(rowsErr)
	}
	return workspaces, "", nil
}

func (repository *Repository) CreateWorkspaceWithOwner(ctx context.Context, userID uuid.UUID, name string) (domain.WorkspaceWithRole, error) {
	transaction, beginErr := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if beginErr != nil {
		return domain.WorkspaceWithRole{}, mapPostgresError(beginErr)
	}
	defer rollbackUnlessCommitted(ctx, transaction)

	workspaceID := uuid.New()
	var workspace domain.WorkspaceWithRole
	workspace.Role = domain.RoleOwner
	insertWorkspaceErr := transaction.QueryRow(ctx, `
		insert into workspaces (id, name, created_by)
		values ($1, $2, $3)
		returning id, name, created_at, updated_at
	`, workspaceID, name, userID).Scan(&workspace.ID, &workspace.Name, &workspace.CreatedAt, &workspace.UpdatedAt)
	if insertWorkspaceErr != nil {
		return domain.WorkspaceWithRole{}, mapPostgresError(insertWorkspaceErr)
	}

	_, insertMemberErr := transaction.Exec(ctx, `
		insert into workspace_members (workspace_id, user_id, role)
		values ($1, $2, $3)
	`, workspaceID, userID, domain.RoleOwner)
	if insertMemberErr != nil {
		return domain.WorkspaceWithRole{}, mapPostgresError(insertMemberErr)
	}
	if commitErr := transaction.Commit(ctx); commitErr != nil {
		return domain.WorkspaceWithRole{}, mapPostgresError(commitErr)
	}
	return workspace, nil
}

func (repository *Repository) GetWorkspaceForUser(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID) (domain.WorkspaceWithRole, error) {
	row := repository.pool.QueryRow(ctx, `
		select w.id, w.name, wm.role, w.created_at, w.updated_at
		from workspaces w
		join workspace_members wm on wm.workspace_id = w.id
		where w.id = $1 and wm.user_id = $2
	`, workspaceID, userID)
	var workspace domain.WorkspaceWithRole
	var role string
	if scanErr := row.Scan(&workspace.ID, &workspace.Name, &role, &workspace.CreatedAt, &workspace.UpdatedAt); scanErr != nil {
		return domain.WorkspaceWithRole{}, mapPostgresError(scanErr)
	}
	workspace.Role = domain.Role(role)
	return workspace, nil
}

func (repository *Repository) UpdateWorkspace(ctx context.Context, workspaceID uuid.UUID, name string) (domain.Workspace, error) {
	row := repository.pool.QueryRow(ctx, `
		update workspaces
		set name = $2, updated_at = now()
		where id = $1
		returning id, name, created_by, created_at, updated_at
	`, workspaceID, name)
	var workspace domain.Workspace
	if scanErr := row.Scan(&workspace.ID, &workspace.Name, &workspace.CreatedBy, &workspace.CreatedAt, &workspace.UpdatedAt); scanErr != nil {
		return domain.Workspace{}, mapPostgresError(scanErr)
	}
	return workspace, nil
}

func (repository *Repository) DeleteWorkspace(ctx context.Context, workspaceID uuid.UUID) error {
	commandTag, execErr := repository.pool.Exec(ctx, `delete from workspaces where id = $1`, workspaceID)
	if execErr != nil {
		return mapPostgresError(execErr)
	}
	if commandTag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (repository *Repository) ListWorkspaceMembers(ctx context.Context, workspaceID uuid.UUID) ([]domain.WorkspaceMember, error) {
	rows, queryErr := repository.pool.Query(ctx, `
		select wm.workspace_id, wm.role, wm.joined_at,
			u.id, u.google_sub, u.email, u.email_verified, u.display_name, u.avatar_url, u.created_at, u.updated_at, u.last_login_at
		from workspace_members wm
		join users u on u.id = wm.user_id
		where wm.workspace_id = $1
		order by wm.joined_at asc
	`, workspaceID)
	if queryErr != nil {
		return nil, mapPostgresError(queryErr)
	}
	defer rows.Close()

	members := make([]domain.WorkspaceMember, 0)
	for rows.Next() {
		member, scanErr := scanWorkspaceMember(rows)
		if scanErr != nil {
			return nil, mapPostgresError(scanErr)
		}
		members = append(members, member)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, mapPostgresError(rowsErr)
	}
	return members, nil
}

func (repository *Repository) AddWorkspaceMember(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID, role domain.Role) (domain.WorkspaceMember, error) {
	row := repository.pool.QueryRow(ctx, `
		with inserted as (
			insert into workspace_members (workspace_id, user_id, role)
			values ($1, $2, $3)
			returning workspace_id, user_id, role, joined_at
		)
		select inserted.workspace_id, inserted.role, inserted.joined_at,
			u.id, u.google_sub, u.email, u.email_verified, u.display_name, u.avatar_url, u.created_at, u.updated_at, u.last_login_at
		from inserted
		join users u on u.id = inserted.user_id
	`, workspaceID, userID, role)
	member, scanErr := scanWorkspaceMember(row)
	if scanErr != nil {
		return domain.WorkspaceMember{}, mapPostgresError(scanErr)
	}
	return member, nil
}

func (repository *Repository) UpdateWorkspaceMember(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID, role domain.Role) (domain.WorkspaceMember, error) {
	row := repository.pool.QueryRow(ctx, `
		with updated as (
			update workspace_members
			set role = $3
			where workspace_id = $1 and user_id = $2
			returning workspace_id, user_id, role, joined_at
		)
		select updated.workspace_id, updated.role, updated.joined_at,
			u.id, u.google_sub, u.email, u.email_verified, u.display_name, u.avatar_url, u.created_at, u.updated_at, u.last_login_at
		from updated
		join users u on u.id = updated.user_id
	`, workspaceID, userID, role)
	member, scanErr := scanWorkspaceMember(row)
	if scanErr != nil {
		return domain.WorkspaceMember{}, mapPostgresError(scanErr)
	}
	return member, nil
}

func (repository *Repository) RemoveWorkspaceMember(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID) error {
	commandTag, execErr := repository.pool.Exec(ctx, `
		delete from workspace_members
		where workspace_id = $1 and user_id = $2
	`, workspaceID, userID)
	if execErr != nil {
		return mapPostgresError(execErr)
	}
	if commandTag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (repository *Repository) CountWorkspaceOwners(ctx context.Context, workspaceID uuid.UUID) (int, error) {
	var ownerCount int
	if scanErr := repository.pool.QueryRow(ctx, `
		select count(*)
		from workspace_members
		where workspace_id = $1 and role = 'owner'
	`, workspaceID).Scan(&ownerCount); scanErr != nil {
		return 0, mapPostgresError(scanErr)
	}
	return ownerCount, nil
}
