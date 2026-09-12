package realtime

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"liveeventsservice/internal/authz"
	"liveeventsservice/internal/config"
	"liveeventsservice/internal/session"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Handler struct {
	config   config.Config
	sessions *session.Store
	authz    *authz.Client
	hub      *Hub
	events   *EventHub
	logger   *log.Logger
	upgrader websocket.Upgrader
}

func NewHandler(appConfig config.Config, sessions *session.Store, authzClient *authz.Client, hub *Hub, eventHub *EventHub, logger *log.Logger) *Handler {
	return &Handler{
		config:   appConfig,
		sessions: sessions,
		authz:    authzClient,
		hub:      hub,
		events:   eventHub,
		logger:   logger,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin: func(request *http.Request) bool {
				if appConfig.FrontendOrigin == "" {
					return true
				}
				origin := request.Header.Get("Origin")
				return origin == "" || origin == appConfig.FrontendOrigin
			},
		},
	}
}

func (handler *Handler) ServeWS(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writer.Header().Set("Allow", http.MethodGet)
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cookie, cookieErr := request.Cookie(handler.config.SessionCookieName)
	if cookieErr != nil || strings.TrimSpace(cookie.Value) == "" {
		http.Error(writer, "session cookie is required", http.StatusUnauthorized)
		return
	}

	userSession, sessionErr := handler.sessions.Validate(request.Context(), cookie.Value)
	if sessionErr != nil {
		if isSessionAuthError(sessionErr) {
			http.Error(writer, "session is invalid or expired", http.StatusUnauthorized)
			return
		}
		http.Error(writer, "session validation is unavailable", http.StatusServiceUnavailable)
		return
	}

	if strings.EqualFold(strings.TrimSpace(request.URL.Query().Get("scope")), "user") {
		handler.serveUserEvents(writer, request, userSession)
		return
	}

	diagramID, diagramErr := parseDiagramID(request)
	if diagramErr != nil {
		http.Error(writer, "diagramId is required and must be a valid UUID", http.StatusBadRequest)
		return
	}

	authorization, authErr := handler.authz.AuthorizeDiagram(request.Context(), diagramID, userSession.UserID)
	if authErr != nil {
		switch {
		case errors.Is(authErr, authz.ErrBadRequest):
			http.Error(writer, "authorization request is invalid", http.StatusBadRequest)
		case errors.Is(authErr, authz.ErrForbidden):
			http.Error(writer, "diagram access is forbidden", http.StatusForbidden)
		case errors.Is(authErr, authz.ErrUnauthorized), errors.Is(authErr, authz.ErrUnavailable):
			http.Error(writer, "authorization service is unavailable", http.StatusServiceUnavailable)
		default:
			http.Error(writer, "authorization service is unavailable", http.StatusServiceUnavailable)
		}
		return
	}

	websocketConn, upgradeErr := handler.upgrader.Upgrade(writer, request, nil)
	if upgradeErr != nil {
		if handler.logger != nil {
			handler.logger.Printf("upgrade websocket: %v", upgradeErr)
		}
		return
	}

	connectionID := uuid.NewString()
	connection := newConnection(
		connectionID,
		diagramID.String(),
		authorization.Diagram.ProjectID,
		authorization.Diagram.WorkspaceID,
		authorization.Role,
		userSession,
		websocketConn,
		handler.hub,
		handler.logger,
	)
	if registerErr := handler.hub.Register(request.Context(), connection); registerErr != nil {
		if handler.logger != nil {
			handler.logger.Printf("register websocket connection %s: %v", connectionID, registerErr)
		}
		_ = websocketConn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "realtime state unavailable"), time.Now().Add(writeWait))
		_ = websocketConn.Close()
		return
	}

	go connection.writePump()
	connection.sendReady()
	handler.hub.SendPresenceSnapshot(request.Context(), connection)
	connection.readPump(request.Context())
}

func (handler *Handler) serveUserEvents(writer http.ResponseWriter, request *http.Request, userSession session.Session) {
	if handler.events == nil {
		http.Error(writer, "user events are unavailable", http.StatusServiceUnavailable)
		return
	}

	websocketConn, upgradeErr := handler.upgrader.Upgrade(writer, request, nil)
	if upgradeErr != nil {
		if handler.logger != nil {
			handler.logger.Printf("upgrade user events websocket: %v", upgradeErr)
		}
		return
	}

	connection := newEventConnection(uuid.NewString(), userSession, websocketConn, handler.events)
	if registerErr := handler.events.Register(request.Context(), connection); registerErr != nil {
		_ = websocketConn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "realtime state unavailable"), time.Now().Add(writeWait))
		_ = websocketConn.Close()
		return
	}

	go connection.writePump()
	connection.sendReady()
	connection.readPump(request.Context())
}

func parseDiagramID(request *http.Request) (uuid.UUID, error) {
	return uuid.Parse(strings.TrimSpace(request.URL.Query().Get("diagramId")))
}

func isSessionAuthError(sessionErr error) bool {
	return errors.Is(sessionErr, session.ErrNotFound) || errors.Is(sessionErr, session.ErrInactive) || errors.Is(sessionErr, session.ErrInvalid)
}
