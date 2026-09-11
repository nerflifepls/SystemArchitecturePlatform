package postgre

import (
	"context"
	"errors"

	"backend/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

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
	transaction, beginErr := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if beginErr != nil {
		return domain.Diagram{}, mapPostgresError(beginErr)
	}
	defer rollbackUnlessCommitted(ctx, transaction)

	row := transaction.QueryRow(ctx, `
		insert into diagrams (id, project_id, title, snapshot_bytes, created_by)
		values ($1, $2, $3, $4, $5)
		returning id, project_id, title, thumbnail_url, snapshot_bytes, snapshot_version, snapshot_base_update_seq, last_update_seq, created_by, created_at, updated_at
	`, diagramID, projectID, title, snapshotBytes, actorUserID)
	diagram, scanErr := scanDiagram(row)
	if scanErr != nil {
		return domain.Diagram{}, mapPostgresError(scanErr)
	}
	if _, insertErr := transaction.Exec(ctx, `
		insert into diagram_snapshots (
			diagram_id, snapshot_version, base_update_seq, snapshot_bytes, snapshot_name, reason, created_by
		) values ($1, $2, $3, $4, $5, 'initial', $6)
	`, diagram.ID, diagram.SnapshotVersion, diagram.SnapshotBaseUpdateSeq, diagram.SnapshotBytes, "Initial state", actorUserID); insertErr != nil {
		return domain.Diagram{}, mapPostgresError(insertErr)
	}
	if commitErr := transaction.Commit(ctx); commitErr != nil {
		return domain.Diagram{}, mapPostgresError(commitErr)
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

func (repository *Repository) SaveDiagramSnapshot(ctx context.Context, diagramID uuid.UUID, snapshotBytes []byte, baseUpdateSeq int64, actorUserID uuid.UUID, name string, reason string) (domain.Diagram, error) {
	transaction, beginErr := repository.pool.BeginTx(ctx, pgx.TxOptions{})
	if beginErr != nil {
		return domain.Diagram{}, mapPostgresError(beginErr)
	}
	defer rollbackUnlessCommitted(ctx, transaction)

	row := transaction.QueryRow(ctx, `
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
			existsErr := transaction.QueryRow(ctx, `select exists(select 1 from diagrams where id = $1)`, diagramID).Scan(&exists)
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
	var snapshotName any
	if name != "" {
		snapshotName = name
	}
	_, historyErr := transaction.Exec(ctx, `
		insert into diagram_snapshots (
			diagram_id, snapshot_version, base_update_seq, snapshot_bytes, snapshot_name, reason, created_by
		) values ($1, $2, $3, $4, $5, $6, $7)
	`, diagram.ID, diagram.SnapshotVersion, diagram.SnapshotBaseUpdateSeq, diagram.SnapshotBytes, snapshotName, reason, actorUserID)
	if historyErr != nil {
		return domain.Diagram{}, mapPostgresError(historyErr)
	}
	_, pruneErr := transaction.Exec(ctx, `
		delete from diagram_snapshots
		where diagram_id = $1
			and reason = 'automatic'
			and snapshot_version not in (
				select snapshot_version
				from diagram_snapshots
				where diagram_id = $1 and reason = 'automatic'
				order by snapshot_version desc
				limit 20
			)
	`, diagramID)
	if pruneErr != nil {
		return domain.Diagram{}, mapPostgresError(pruneErr)
	}
	_, deleteErr := transaction.Exec(ctx, `
		delete from diagram_updates
		where diagram_id = $1 and seq <= $2
	`, diagramID, baseUpdateSeq)
	if deleteErr != nil {
		return domain.Diagram{}, mapPostgresError(deleteErr)
	}
	if commitErr := transaction.Commit(ctx); commitErr != nil {
		return domain.Diagram{}, mapPostgresError(commitErr)
	}
	return diagram, nil
}

func (repository *Repository) ListDiagramSnapshots(ctx context.Context, diagramID uuid.UUID, limit int) ([]domain.DiagramSnapshot, error) {
	rows, queryErr := repository.pool.Query(ctx, `
		select ds.diagram_id, ds.snapshot_version, ds.base_update_seq,
			octet_length(ds.snapshot_bytes), ds.snapshot_name, ds.reason,
			coalesce(ds.created_by, '00000000-0000-0000-0000-000000000000'::uuid),
			coalesce(u.display_name, 'Unknown collaborator'), ds.created_at
		from diagram_snapshots ds
		left join users u on u.id = ds.created_by
		where ds.diagram_id = $1
		order by ds.snapshot_version desc
		limit $2
	`, diagramID, limit)
	if queryErr != nil {
		return nil, mapPostgresError(queryErr)
	}
	defer rows.Close()

	snapshots := make([]domain.DiagramSnapshot, 0)
	for rows.Next() {
		var snapshot domain.DiagramSnapshot
		var snapshotName pgtype.Text
		if scanErr := rows.Scan(
			&snapshot.DiagramID,
			&snapshot.SnapshotVersion,
			&snapshot.BaseUpdateSeq,
			&snapshot.ByteSize,
			&snapshotName,
			&snapshot.Reason,
			&snapshot.CreatedBy,
			&snapshot.AuthorName,
			&snapshot.CreatedAt,
		); scanErr != nil {
			return nil, mapPostgresError(scanErr)
		}
		snapshot.Name = textPtr(snapshotName)
		snapshots = append(snapshots, snapshot)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, mapPostgresError(rowsErr)
	}
	return snapshots, nil
}

func (repository *Repository) GetDiagramSnapshot(ctx context.Context, diagramID uuid.UUID, snapshotVersion int64) (domain.DiagramSnapshot, error) {
	row := repository.pool.QueryRow(ctx, `
		select ds.diagram_id, ds.snapshot_version, ds.base_update_seq, ds.snapshot_bytes,
			octet_length(ds.snapshot_bytes), ds.snapshot_name, ds.reason,
			coalesce(ds.created_by, '00000000-0000-0000-0000-000000000000'::uuid),
			coalesce(u.display_name, 'Unknown collaborator'), ds.created_at
		from diagram_snapshots ds
		left join users u on u.id = ds.created_by
		where ds.diagram_id = $1 and ds.snapshot_version = $2
	`, diagramID, snapshotVersion)
	var snapshot domain.DiagramSnapshot
	var snapshotName pgtype.Text
	if scanErr := row.Scan(
		&snapshot.DiagramID,
		&snapshot.SnapshotVersion,
		&snapshot.BaseUpdateSeq,
		&snapshot.SnapshotBytes,
		&snapshot.ByteSize,
		&snapshotName,
		&snapshot.Reason,
		&snapshot.CreatedBy,
		&snapshot.AuthorName,
		&snapshot.CreatedAt,
	); scanErr != nil {
		return domain.DiagramSnapshot{}, mapPostgresError(scanErr)
	}
	snapshot.Name = textPtr(snapshotName)
	return snapshot, nil
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
