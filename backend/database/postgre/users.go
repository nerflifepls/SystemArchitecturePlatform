package postgre

import (
	"context"
	"fmt"

	"backend/domain"

	"github.com/google/uuid"
)

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
