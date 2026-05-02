package api

import (
	"net/http"
	"strings"

	"backend/config"
	"backend/services"
)

func corsMiddleware(frontendOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			origin := request.Header.Get("Origin")
			if frontendOrigin != "" && origin == frontendOrigin {
				writer.Header().Set("Access-Control-Allow-Origin", frontendOrigin)
				writer.Header().Set("Vary", "Origin")
				writer.Header().Set("Access-Control-Allow-Credentials", "true")
				writer.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
				writer.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Update-Id,X-Client-Id,X-Base-Update-Seq,X-Request-Id")
			}
			if request.Method == http.MethodOptions {
				writer.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(writer, request)
		})
	}
}

func sessionMiddleware(authService *services.AuthService, appConfig config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			cookie, cookieErr := request.Cookie(appConfig.SessionCookieName)
			if cookieErr != nil || cookie.Value == "" {
				writeError(writer, request, services.Unauthorized("session cookie is required"))
				return
			}
			result, authErr := authService.AuthenticateSession(request.Context(), cookie.Value)
			if authErr != nil {
				writeError(writer, request, authErr)
				return
			}
			next.ServeHTTP(writer, request.WithContext(withAuth(request.Context(), AuthContext{User: result.User, Session: result.Session})))
		})
	}
}

func internalTokenMiddleware(appConfig config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if appConfig.BackendInternalToken == "" {
				writeError(writer, request, services.Unavailable("internal token is not configured"))
				return
			}
			providedToken := strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer ")
			if providedToken == "" || providedToken != appConfig.BackendInternalToken {
				writeError(writer, request, services.Unauthorized("invalid internal token"))
				return
			}
			next.ServeHTTP(writer, request)
		})
	}
}
