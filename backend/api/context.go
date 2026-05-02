package api

import (
	"context"

	"backend/domain"
)

type authContextKey struct{}

type AuthContext struct {
	User    domain.User
	Session domain.Session
}

func withAuth(ctx context.Context, auth AuthContext) context.Context {
	return context.WithValue(ctx, authContextKey{}, auth)
}

func currentAuth(ctx context.Context) (AuthContext, bool) {
	auth, ok := ctx.Value(authContextKey{}).(AuthContext)
	return auth, ok
}
