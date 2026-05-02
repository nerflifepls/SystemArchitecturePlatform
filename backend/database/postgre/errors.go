package postgre

import (
	"errors"

	"backend/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

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
