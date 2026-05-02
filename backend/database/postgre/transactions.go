package postgre

import (
	"context"

	"github.com/jackc/pgx/v5"
)

func rollbackUnlessCommitted(ctx context.Context, transaction pgx.Tx) {
	_ = transaction.Rollback(ctx)
}
