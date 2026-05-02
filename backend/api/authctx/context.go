package authctx

import (
	"context"

	"backend/domain"
)

type contextKey struct{}

type Context struct {
	User    domain.User
	Session domain.Session
}

func WithAuth(ctx context.Context, auth Context) context.Context {
	return context.WithValue(ctx, contextKey{}, auth)
}

func Current(ctx context.Context) (Context, bool) {
	auth, ok := ctx.Value(contextKey{}).(Context)
	return auth, ok
}
