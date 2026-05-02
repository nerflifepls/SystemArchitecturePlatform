package postgre

import (
	"context"
	"embed"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.up.sql
var migrationFiles embed.FS

func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("postgres pool is nil")
	}

	entries, readErr := migrationFiles.ReadDir("migrations")
	if readErr != nil {
		return fmt.Errorf("read migrations: %w", readErr)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".up.sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	transaction, beginErr := pool.BeginTx(ctx, pgx.TxOptions{})
	if beginErr != nil {
		return fmt.Errorf("begin migrations: %w", beginErr)
	}
	defer rollbackUnlessCommitted(ctx, transaction)

	if _, execErr := transaction.Exec(ctx, `
		create table if not exists schema_migrations (
			version text primary key,
			applied_at timestamptz not null default now()
		)
	`); execErr != nil {
		return fmt.Errorf("ensure schema_migrations: %w", execErr)
	}

	for _, name := range names {
		version := strings.TrimSuffix(name, ".up.sql")
		var exists bool
		if scanErr := transaction.QueryRow(ctx, `select exists(select 1 from schema_migrations where version = $1)`, version).Scan(&exists); scanErr != nil {
			return fmt.Errorf("check migration %s: %w", version, scanErr)
		}
		if exists {
			continue
		}

		content, fileErr := migrationFiles.ReadFile(filepath.ToSlash(filepath.Join("migrations", name)))
		if fileErr != nil {
			return fmt.Errorf("read migration %s: %w", version, fileErr)
		}
		if _, execErr := transaction.Exec(ctx, string(content)); execErr != nil {
			return fmt.Errorf("apply migration %s: %w", version, execErr)
		}
		if _, insertErr := transaction.Exec(ctx, `insert into schema_migrations (version) values ($1)`, version); insertErr != nil {
			return fmt.Errorf("record migration %s: %w", version, insertErr)
		}
	}

	if commitErr := transaction.Commit(ctx); commitErr != nil {
		return fmt.Errorf("commit migrations: %w", commitErr)
	}
	return nil
}
