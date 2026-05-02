package handlers

import (
	"net/http"
	"strings"

	apirequest "backend/api/request"
	"backend/api/response"
	"backend/services"

	"github.com/google/uuid"
)

type InternalHandler struct {
	diagrams *services.DiagramService
}

type internalAuthorizeResponse struct {
	Allowed bool                     `json:"allowed"`
	Role    string                   `json:"role"`
	Diagram internalAuthorizeDiagram `json:"diagram"`
	User    userResponse             `json:"user"`
}

type internalAuthorizeDiagram struct {
	ID          string `json:"id"`
	ProjectID   string `json:"projectId"`
	WorkspaceID string `json:"workspaceId"`
}

func NewInternalHandler(diagramService *services.DiagramService) InternalHandler {
	return InternalHandler{diagrams: diagramService}
}

func (handler InternalHandler) AuthorizeDiagram(writer http.ResponseWriter, request *http.Request) {
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	userID, userParseErr := uuid.Parse(strings.TrimSpace(request.URL.Query().Get("userId")))
	if userParseErr != nil {
		response.WriteError(writer, request, services.BadRequest("userId must be a valid UUID"))
		return
	}
	access, accessErr := handler.diagrams.AuthorizeInternal(request.Context(), diagramID, userID)
	if accessErr != nil {
		response.WriteError(writer, request, accessErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, internalAuthorizeResponse{
		Allowed: access.Allowed,
		Role:    string(access.Role),
		Diagram: internalAuthorizeDiagram{ID: access.DiagramID.String(), ProjectID: access.ProjectID.String(), WorkspaceID: access.WorkspaceID.String()},
		User:    userToResponse(access.User),
	})
}
