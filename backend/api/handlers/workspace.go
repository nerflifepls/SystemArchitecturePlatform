package handlers

import (
	"net/http"

	"backend/api/authctx"
	apirequest "backend/api/request"
	"backend/api/response"
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

func NewWorkspaceHandler(workspaceService *services.WorkspaceService) WorkspaceHandler {
	return WorkspaceHandler{workspaces: workspaceService}
}

func (handler WorkspaceHandler) List(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	items, nextCursor, listErr := handler.workspaces.ListWorkspaces(request.Context(), auth.User.ID, apirequest.Limit(request), apirequest.OptionalCursor(request))
	if listErr != nil {
		response.WriteError(writer, request, listErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, workspaceListResponse{Items: items, NextCursor: apirequest.NullableCursor(nextCursor)})
}

func (handler WorkspaceHandler) Create(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	var payload workspaceRequest
	if decodeErr := response.DecodeJSON(request, &payload); decodeErr != nil {
		response.WriteError(writer, request, decodeErr)
		return
	}
	workspace, createErr := handler.workspaces.CreateWorkspace(request.Context(), auth.User.ID, payload.Name)
	if createErr != nil {
		response.WriteError(writer, request, createErr)
		return
	}
	response.WriteJSON(writer, http.StatusCreated, workspaceResponse{Workspace: workspace})
}

func (handler WorkspaceHandler) Get(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := apirequest.UUIDParam(request, "workspaceId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	workspace, getErr := handler.workspaces.GetWorkspace(request.Context(), auth.User.ID, workspaceID)
	if getErr != nil {
		response.WriteError(writer, request, getErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, workspaceResponse{Workspace: workspace})
}

func (handler WorkspaceHandler) Update(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := apirequest.UUIDParam(request, "workspaceId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	var payload workspaceRequest
	if decodeErr := response.DecodeJSON(request, &payload); decodeErr != nil {
		response.WriteError(writer, request, decodeErr)
		return
	}
	workspace, updateErr := handler.workspaces.UpdateWorkspace(request.Context(), auth.User.ID, workspaceID, payload.Name)
	if updateErr != nil {
		response.WriteError(writer, request, updateErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, workspaceResponse{Workspace: workspace})
}

func (handler WorkspaceHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := apirequest.UUIDParam(request, "workspaceId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	if deleteErr := handler.workspaces.DeleteWorkspace(request.Context(), auth.User.ID, workspaceID); deleteErr != nil {
		response.WriteError(writer, request, deleteErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler WorkspaceHandler) ListMembers(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := apirequest.UUIDParam(request, "workspaceId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	members, listErr := handler.workspaces.ListMembers(request.Context(), auth.User.ID, workspaceID)
	if listErr != nil {
		response.WriteError(writer, request, listErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, membersResponse{Items: members})
}

func (handler WorkspaceHandler) AddMember(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := apirequest.UUIDParam(request, "workspaceId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	var payload addMemberRequest
	if decodeErr := response.DecodeJSON(request, &payload); decodeErr != nil {
		response.WriteError(writer, request, decodeErr)
		return
	}
	member, addErr := handler.workspaces.AddMember(request.Context(), auth.User.ID, workspaceID, payload.Email, payload.Role)
	if addErr != nil {
		response.WriteError(writer, request, addErr)
		return
	}
	response.WriteJSON(writer, http.StatusCreated, memberResponse{Member: member})
}

func (handler WorkspaceHandler) UpdateMember(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := apirequest.UUIDParam(request, "workspaceId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	userID, userParseErr := apirequest.UUIDParam(request, "userId")
	if userParseErr != nil {
		response.WriteError(writer, request, userParseErr)
		return
	}
	var payload updateMemberRequest
	if decodeErr := response.DecodeJSON(request, &payload); decodeErr != nil {
		response.WriteError(writer, request, decodeErr)
		return
	}
	member, updateErr := handler.workspaces.UpdateMember(request.Context(), auth.User.ID, workspaceID, userID, payload.Role)
	if updateErr != nil {
		response.WriteError(writer, request, updateErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, memberResponse{Member: member})
}

func (handler WorkspaceHandler) RemoveMember(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	workspaceID, parseErr := apirequest.UUIDParam(request, "workspaceId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	userID, userParseErr := apirequest.UUIDParam(request, "userId")
	if userParseErr != nil {
		response.WriteError(writer, request, userParseErr)
		return
	}
	if removeErr := handler.workspaces.RemoveMember(request.Context(), auth.User.ID, workspaceID, userID); removeErr != nil {
		response.WriteError(writer, request, removeErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
