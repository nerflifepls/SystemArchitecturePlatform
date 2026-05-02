package postgre

import (
	"context"
	"errors"
	"fmt"
	"time"

	"backend/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (repository *Repository) UpsertGoogleUser(ctx context.Context, identity domain.GoogleIdentity) (domain.User, error) {
	if repository == nil || repository.pool == nil {
		return domain.User{}, fmt.Errorf("postgres pool is nil")
	}
	userID := uuid.New()
	row := repository.pool.QueryRow(ctx, `
		insert into users (id, google_sub, email, email_verified, display_name, avatar_url, last_login_at)
		values ($1, $2, lower($3), $4, $5, $6, now())
		on conflict (google_sub) do update set
			email = excluded.email,
			email_verified = excluded.email_verified,
			display_name = excluded.display_name,
			avatar_url = excluded.avatar_url,
			updated_at = now(),
			last_login_at = now()
		returning id, google_sub, email, email_verified, display_name, avatar_url, created_at, updated_at, last_login_at
	`, userID, identity.Subject, identity.Email, identity.EmailVerified, identity.DisplayName, identity.AvatarURL)
	user, scanErr := scanUser(row)
	if scanErr != nil {
		return domain.User{}, mapPostgresError(scanErr)
	}
	return user, nil
}

func (repository *Repository) GetUserByID(ctx context.Context, userID uuid.UUID) (domain.User, error) {
	row := repository.pool.QueryRow(ctx, `
		select id, google_sub, email, email_verified, display_name, avatar_url, created_at, updated_at, last_login_at
		from users
		where id = $1
	`, userID)
	user, scanErr := scanUser(row)
	if scanErr != nil {
		return domain.User{}, mapPostgresError(scanErr)
	}
	return user, nil
}

func (repository *Repository) GetUserByEmail(ctx context.Context, email string) (domain.User, error) {
	row := repository.pool.QueryRow(ctx, `
		select id, google_sub, email, email_verified, display_name, avatar_url, created_at, updated_at, last_login_at
		from users
		where email = lower($1)
	`, email)
	user, scanErr := scanUser(row)
	if scanErr != nil {
		return domain.User{}, mapPostgresError(scanErr)
	}
	return user, nil
}

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

func (repository *Repository) ListDiagrams(ctx context.Context, projectID uuid.UUID, limit int, cursor string) ([]domain.Diagram, string, error) {
	rows, queryErr := repository.pool.Query(ctx, `
		select id, project_id, title, thumbnail_url, snapshot_bytes, snapshot_version, snapshot_base_update_seq, last_update_seq, created_by, created_at, updated_at
		from diagrams
		where project_id = $1
		order by updated_at desc, id desc
		limit $2
	`, projectID, limit)
	if queryErr != nil {
		return nil, "", mapPostgresError(queryErr)
	}
	defer rows.Close()

	diagrams := make([]domain.Diagram, 0)
	for rows.Next() {
		diagram, scanErr := scanDiagram(rows)
		if scanErr != nil {
			return nil, "", mapPostgresError(scanErr)
		}
		diagrams = append(diagrams, diagram)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, "", mapPostgresError(rowsErr)
	}
	return diagrams, "", nil
}

func (repository *Repository) CreateDiagram(ctx context.Context, projectID uuid.UUID, actorUserID uuid.UUID, title string, snapshotBytes []byte) (domain.Diagram, error) {
	diagramID := uuid.New()
	row := repository.pool.QueryRow(ctx, `
		insert into diagrams (id, project_id, title, snapshot_bytes, created_by)
		values ($1, $2, $3, $4, $5)
		returning id, project_id, title, thumbnail_url, snapshot_bytes, snapshot_version, snapshot_base_update_seq, last_update_seq, created_by, created_at, updated_at
	`, diagramID, projectID, title, snapshotBytes, actorUserID)
	diagram, scanErr := scanDiagram(row)
	if scanErr != nil {
		return domain.Diagram{}, mapPostgresError(scanErr)
	}
	return diagram, nil
}

func (repository *Repository) GetDiagramByID(ctx context.Context, diagramID uuid.UUID) (domain.Diagram, error) {
	row := repository.pool.QueryRow(ctx, `
		select id, project_id, title, thumbnail_url, snapshot_bytes, snapshot_version, snapshot_base_update_seq, last_update_seq, created_by, created_at, updated_at
		from diagrams
		where id = $1
	`, diagramID)
	diagram, scanErr := scanDiagram(row)
	if scanErr != nil {
		return domain.Diagram{}, mapPostgresError(scanErr)
	}
	return diagram, nil
}

func (repository *Repository) UpdateDiagramTitle(ctx context.Context, diagramID uuid.UUID, title string) (domain.Diagram, error) {
	row := repository.pool.QueryRow(ctx, `
		update diagrams
		set title = $2, updated_at = now()
		where id = $1
		returning id, project_id, title, thumbnail_url, snapshot_bytes, snapshot_version, snapshot_base_update_seq, last_update_seq, created_by, created_at, updated_at
	`, diagramID, title)
	diagram, scanErr := scanDiagram(row)
	if scanErr != nil {
		return domain.Diagram{}, mapPostgresError(scanErr)
	}
	return diagram, nil
}

func (repository *Repository) DeleteDiagram(ctx context.Context, diagramID uuid.UUID) error {
	commandTag, execErr := repository.pool.Exec(ctx, `delete from diagrams where id = $1`, diagramID)
	if execErr != nil {
		return mapPostgresError(execErr)
	}
	if commandTag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (repository *Repository) SaveDiagramSnapshot(ctx context.Context, diagramID uuid.UUID, snapshotBytes []byte, baseUpdateSeq int64) (domain.Diagram, error) {
	row := repository.pool.QueryRow(ctx, `
		update diagrams
		set snapshot_bytes = $2,
			snapshot_version = snapshot_version + 1,
			snapshot_base_update_seq = $3,
			updated_at = now()
		where id = $1 and snapshot_base_update_seq <= $3 and last_update_seq >= $3
		returning id, project_id, title, thumbnail_url, snapshot_bytes, snapshot_version, snapshot_base_update_seq, last_update_seq, created_by, created_at, updated_at
	`, diagramID, snapshotBytes, baseUpdateSeq)
	diagram, scanErr := scanDiagram(row)
	if scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			var exists bool
			existsErr := repository.pool.QueryRow(ctx, `select exists(select 1 from diagrams where id = $1)`, diagramID).Scan(&exists)
			if existsErr != nil {
				return domain.Diagram{}, mapPostgresError(existsErr)
			}
			if !exists {
				return domain.Diagram{}, domain.ErrNotFound
			}
			return domain.Diagram{}, domain.ErrConflict
		}
		return domain.Diagram{}, mapPostgresError(scanErr)
	}
	return diagram, nil
}

func (repository *Repository) ListDiagramUpdates(ctx context.Context, diagramID uuid.UUID, afterSeq int64) ([]domain.DiagramUpdate, error) {
	rows, queryErr := repository.pool.Query(ctx, `
		select diagram_id, seq, update_id, client_id, author_user_id, update_bytes, created_at
		from diagram_updates
		where diagram_id = $1 and seq > $2
		order by seq asc
	`, diagramID, afterSeq)
	if queryErr != nil {
		return nil, mapPostgresError(queryErr)
	}
	defer rows.Close()

	updates := make([]domain.DiagramUpdate, 0)
	for rows.Next() {
		update, scanErr := scanDiagramUpdate(rows)
		if scanErr != nil {
			return nil, mapPostgresError(scanErr)
		}
		updates = append(updates, update)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, mapPostgresError(rowsErr)
	}
	return updates, nil
}

func (repository *Repository) AppendDiagramUpdate(ctx context.Context, diagramID uuid.UUID, updateID uuid.UUID, clientID string, authorUserID uuid.UUID, updateBytes []byte) (domain.DiagramUpdate, bool, error) {
	transaction, beginErr := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if beginErr != nil {
		return domain.DiagramUpdate{}, false, mapPostgresError(beginErr)
	}
	defer rollbackUnlessCommitted(ctx, transaction)

	var lastUpdateSeq int64
	if scanErr := transaction.QueryRow(ctx, `select last_update_seq from diagrams where id = $1 for update`, diagramID).Scan(&lastUpdateSeq); scanErr != nil {
		return domain.DiagramUpdate{}, false, mapPostgresError(scanErr)
	}

	existingRow := transaction.QueryRow(ctx, `
		select diagram_id, seq, update_id, client_id, author_user_id, update_bytes, created_at
		from diagram_updates
		where diagram_id = $1 and update_id = $2
	`, diagramID, updateID)
	existingUpdate, existingErr := scanDiagramUpdate(existingRow)
	if existingErr == nil {
		if commitErr := transaction.Commit(ctx); commitErr != nil {
			return domain.DiagramUpdate{}, false, mapPostgresError(commitErr)
		}
		return existingUpdate, true, nil
	}
	if !errors.Is(existingErr, pgx.ErrNoRows) {
		return domain.DiagramUpdate{}, false, mapPostgresError(existingErr)
	}

	newSeq := lastUpdateSeq + 1
	insertRow := transaction.QueryRow(ctx, `
		insert into diagram_updates (diagram_id, seq, update_id, client_id, author_user_id, update_bytes)
		values ($1, $2, $3, $4, $5, $6)
		returning diagram_id, seq, update_id, client_id, author_user_id, update_bytes, created_at
	`, diagramID, newSeq, updateID, clientID, authorUserID, updateBytes)
	insertedUpdate, insertErr := scanDiagramUpdate(insertRow)
	if insertErr != nil {
		return domain.DiagramUpdate{}, false, mapPostgresError(insertErr)
	}
	_, updateErr := transaction.Exec(ctx, `
		update diagrams
		set last_update_seq = $2, updated_at = now()
		where id = $1
	`, diagramID, newSeq)
	if updateErr != nil {
		return domain.DiagramUpdate{}, false, mapPostgresError(updateErr)
	}
	if commitErr := transaction.Commit(ctx); commitErr != nil {
		return domain.DiagramUpdate{}, false, mapPostgresError(commitErr)
	}
	return insertedUpdate, false, nil
}

func (repository *Repository) GetDiagramAccess(ctx context.Context, diagramID uuid.UUID, userID uuid.UUID) (domain.DiagramAccess, error) {
	row := repository.pool.QueryRow(ctx, `
		select d.id, p.id, p.workspace_id, wm.role,
			u.id, u.google_sub, u.email, u.email_verified, u.display_name, u.avatar_url, u.created_at, u.updated_at, u.last_login_at
		from diagrams d
		join projects p on p.id = d.project_id
		join workspace_members wm on wm.workspace_id = p.workspace_id
		join users u on u.id = wm.user_id
		where d.id = $1 and wm.user_id = $2
	`, diagramID, userID)
	var access domain.DiagramAccess
	var role string
	user, scanErr := scanUserWithPrefix(row, &access.DiagramID, &access.ProjectID, &access.WorkspaceID, &role)
	if scanErr != nil {
		return domain.DiagramAccess{}, mapPostgresError(scanErr)
	}
	access.User = user
	access.Role = domain.Role(role)
	access.Allowed = true
	return access, nil
}

type scanner interface {
	Scan(destinations ...any) error
}

func scanUser(row scanner) (domain.User, error) {
	var user domain.User
	var avatarURL pgtype.Text
	var lastLoginAt pgtype.Timestamptz
	if scanErr := row.Scan(&user.ID, &user.GoogleSub, &user.Email, &user.EmailVerified, &user.DisplayName, &avatarURL, &user.CreatedAt, &user.UpdatedAt, &lastLoginAt); scanErr != nil {
		return domain.User{}, scanErr
	}
	user.AvatarURL = textPtr(avatarURL)
	user.LastLoginAt = timePtr(lastLoginAt)
	return user, nil
}

func scanUserWithPrefix(row scanner, prefixDestinations ...any) (domain.User, error) {
	var user domain.User
	var avatarURL pgtype.Text
	var lastLoginAt pgtype.Timestamptz
	destinations := append(prefixDestinations, &user.ID, &user.GoogleSub, &user.Email, &user.EmailVerified, &user.DisplayName, &avatarURL, &user.CreatedAt, &user.UpdatedAt, &lastLoginAt)
	if scanErr := row.Scan(destinations...); scanErr != nil {
		return domain.User{}, scanErr
	}
	user.AvatarURL = textPtr(avatarURL)
	user.LastLoginAt = timePtr(lastLoginAt)
	return user, nil
}

func scanWorkspaceMember(row scanner) (domain.WorkspaceMember, error) {
	var member domain.WorkspaceMember
	var role string
	user, scanErr := scanUserWithPrefix(row, &member.WorkspaceID, &role, &member.JoinedAt)
	if scanErr != nil {
		return domain.WorkspaceMember{}, scanErr
	}
	member.Role = domain.Role(role)
	member.User = user
	return member, nil
}

func scanProject(row scanner) (domain.Project, error) {
	var project domain.Project
	var description pgtype.Text
	if scanErr := row.Scan(&project.ID, &project.WorkspaceID, &project.Name, &description, &project.CreatedBy, &project.CreatedAt, &project.UpdatedAt); scanErr != nil {
		return domain.Project{}, scanErr
	}
	project.Description = textPtr(description)
	return project, nil
}

func scanDiagram(row scanner) (domain.Diagram, error) {
	var diagram domain.Diagram
	var thumbnailURL pgtype.Text
	if scanErr := row.Scan(&diagram.ID, &diagram.ProjectID, &diagram.Title, &thumbnailURL, &diagram.SnapshotBytes, &diagram.SnapshotVersion, &diagram.SnapshotBaseUpdateSeq, &diagram.LastUpdateSeq, &diagram.CreatedBy, &diagram.CreatedAt, &diagram.UpdatedAt); scanErr != nil {
		return domain.Diagram{}, scanErr
	}
	diagram.ThumbnailURL = textPtr(thumbnailURL)
	return diagram, nil
}

func scanDiagramUpdate(row scanner) (domain.DiagramUpdate, error) {
	var update domain.DiagramUpdate
	if scanErr := row.Scan(&update.DiagramID, &update.Seq, &update.UpdateID, &update.ClientID, &update.AuthorUserID, &update.UpdateBytes, &update.CreatedAt); scanErr != nil {
		return domain.DiagramUpdate{}, scanErr
	}
	return update, nil
}

func textPtr(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	text := value.String
	return &text
}

func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	readTime := value.Time
	return &readTime
}

func mapPostgresError(postgresErr error) error {
	if errors.Is(postgresErr, pgx.ErrNoRows) {
		return domain.ErrNotFound
	}
	var pgError *pgconn.PgError
	if errors.As(postgresErr, &pgError) && pgError.Code == "23505" {
		return domain.ErrConflict
	}
	return postgresErr
}

func rollbackUnlessCommitted(ctx context.Context, transaction pgx.Tx) {
	_ = transaction.Rollback(ctx)
}
