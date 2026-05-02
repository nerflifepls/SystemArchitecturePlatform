package api

import (
	"net/http"

	"backend/domain"
	"backend/services"
)

type WorkspaceHandler struct {
	workspaces *services.WorkspaceService
}

type workspaceListResponse struct {
	Items      []domain.WorkspaceWithRole `json:"items"`
	NextCursor *string                    `json:"nextCursor"`
}

type workspaceResponse struct {
	Workspace domain.WorkspaceWithRole `json:"workspace"`
}

type workspaceRequest struct {
	Name string `json:"name"`
}

type membersResponse struct {
	Items []domain.WorkspaceMember `json:"items"`
}

type memberResponse struct {
	Member domain.WorkspaceMember `json:"member"`
}

type addMemberRequest struct {
	Email string      `json:"email"`
	Role  domain.Role `json:"role"`
}

type updateMemberRequest struct {
	Role domain.Role `json:"role"`
}

func (handler WorkspaceHandler) List(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	items, nextCursor, listErr := handler.workspaces.ListWorkspaces(request.Context(), auth.User.ID, parseLimit(request), optionalCursor(request))
	if listErr != nil {
		writeError(writer, request, listErr)
		return
	}
	writeJSON(writer, http.StatusOK, workspaceListResponse{Items: items, NextCursor: nullableCursor(nextCursor)})
}

func (handler WorkspaceHandler) Create(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	var payload workspaceRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	workspace, createErr := handler.workspaces.CreateWorkspace(request.Context(), auth.User.ID, payload.Name)
	if createErr != nil {
		writeError(writer, request, createErr)
		return
	}
	writeJSON(writer, http.StatusCreated, workspaceResponse{Workspace: workspace})
}

func (handler WorkspaceHandler) Get(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := parseUUIDParam(request, "workspaceId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	workspace, getErr := handler.workspaces.GetWorkspace(request.Context(), auth.User.ID, workspaceID)
	if getErr != nil {
		writeError(writer, request, getErr)
		return
	}
	writeJSON(writer, http.StatusOK, workspaceResponse{Workspace: workspace})
}

func (handler WorkspaceHandler) Update(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := parseUUIDParam(request, "workspaceId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	var payload workspaceRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	workspace, updateErr := handler.workspaces.UpdateWorkspace(request.Context(), auth.User.ID, workspaceID, payload.Name)
	if updateErr != nil {
		writeError(writer, request, updateErr)
		return
	}
	writeJSON(writer, http.StatusOK, workspaceResponse{Workspace: workspace})
}

func (handler WorkspaceHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := parseUUIDParam(request, "workspaceId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	if deleteErr := handler.workspaces.DeleteWorkspace(request.Context(), auth.User.ID, workspaceID); deleteErr != nil {
		writeError(writer, request, deleteErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler WorkspaceHandler) ListMembers(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := parseUUIDParam(request, "workspaceId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	members, listErr := handler.workspaces.ListMembers(request.Context(), auth.User.ID, workspaceID)
	if listErr != nil {
		writeError(writer, request, listErr)
		return
	}
	writeJSON(writer, http.StatusOK, membersResponse{Items: members})
}

func (handler WorkspaceHandler) AddMember(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := parseUUIDParam(request, "workspaceId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	var payload addMemberRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	member, addErr := handler.workspaces.AddMember(request.Context(), auth.User.ID, workspaceID, payload.Email, payload.Role)
	if addErr != nil {
		writeError(writer, request, addErr)
		return
	}
	writeJSON(writer, http.StatusCreated, memberResponse{Member: member})
}

func (handler WorkspaceHandler) UpdateMember(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := parseUUIDParam(request, "workspaceId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	userID, userParseErr := parseUUIDParam(request, "userId")
	if userParseErr != nil {
		writeError(writer, request, userParseErr)
		return
	}
	var payload updateMemberRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	member, updateErr := handler.workspaces.UpdateMember(request.Context(), auth.User.ID, workspaceID, userID, payload.Role)
	if updateErr != nil {
		writeError(writer, request, updateErr)
		return
	}
	writeJSON(writer, http.StatusOK, memberResponse{Member: member})
}

func (handler WorkspaceHandler) RemoveMember(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := parseUUIDParam(request, "workspaceId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	userID, userParseErr := parseUUIDParam(request, "userId")
	if userParseErr != nil {
		writeError(writer, request, userParseErr)
		return
	}
	if removeErr := handler.workspaces.RemoveMember(request.Context(), auth.User.ID, workspaceID, userID); removeErr != nil {
		writeError(writer, request, removeErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
