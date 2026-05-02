package api

import (
	"net/http"
	"time"

	"backend/config"
	"backend/domain"
	"backend/services"
)

type AuthHandler struct {
	config config.Config
	auth   *services.AuthService
}

type googleLoginRequest struct {
	IDToken string `json:"idToken"`
}

type authResponse struct {
	User    userResponse    `json:"user"`
	Session sessionResponse `json:"session"`
}

type userResponse struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

type sessionResponse struct {
	ID         string    `json:"id,omitempty"`
	ExpiresAt  time.Time `json:"expiresAt"`
	LastSeenAt time.Time `json:"lastSeenAt,omitempty"`
}

func (handler AuthHandler) Google(writer http.ResponseWriter, request *http.Request) {
	var payload googleLoginRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	result, loginErr := handler.auth.LoginWithGoogle(request.Context(), payload.IDToken)
	if loginErr != nil {
		writeError(writer, request, loginErr)
		return
	}
	setSessionCookie(writer, handler.config, result.Session)
	writeJSON(writer, http.StatusOK, authResponse{
		User:    userToResponse(result.User),
		Session: sessionResponse{ExpiresAt: result.Session.ExpiresAt},
	})
}

func (handler AuthHandler) Me(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	setSessionCookie(writer, handler.config, auth.Session)
	writeJSON(writer, http.StatusOK, authResponse{
		User:    userToResponse(auth.User),
		Session: sessionResponse{ID: auth.Session.ID, ExpiresAt: auth.Session.ExpiresAt, LastSeenAt: auth.Session.LastSeenAt},
	})
}

func (handler AuthHandler) Refresh(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	setSessionCookie(writer, handler.config, auth.Session)
	writeJSON(writer, http.StatusOK, authResponse{
		User:    userToResponse(auth.User),
		Session: sessionResponse{ID: auth.Session.ID, ExpiresAt: auth.Session.ExpiresAt, LastSeenAt: auth.Session.LastSeenAt},
	})
}

func (handler AuthHandler) Logout(writer http.ResponseWriter, request *http.Request) {
	cookie, cookieErr := request.Cookie(handler.config.SessionCookieName)
	if cookieErr == nil && cookie.Value != "" {
		if logoutErr := handler.auth.LogoutBySessionID(request.Context(), cookie.Value); logoutErr != nil {
			writeError(writer, request, logoutErr)
			return
		}
	}
	expireSessionCookie(writer, handler.config)
	writer.WriteHeader(http.StatusNoContent)
}

func userToResponse(user domain.User) userResponse {
	return userResponse{ID: user.ID.String(), Email: user.Email, Name: user.DisplayName, AvatarURL: user.AvatarURL}
}

func setSessionCookie(writer http.ResponseWriter, appConfig config.Config, session domain.Session) {
	http.SetCookie(writer, &http.Cookie{
		Name:     appConfig.SessionCookieName,
		Value:    session.ID,
		Path:     "/",
		HttpOnly: true,
		Secure:   appConfig.SessionCookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(appConfig.SessionTTL.Seconds()),
		Expires:  session.ExpiresAt,
	})
}

func expireSessionCookie(writer http.ResponseWriter, appConfig config.Config) {
	http.SetCookie(writer, &http.Cookie{
		Name:     appConfig.SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   appConfig.SessionCookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}
