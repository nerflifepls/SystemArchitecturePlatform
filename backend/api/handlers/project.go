package handlers

import (
	"net/http"

	"backend/api/authctx"
	apirequest "backend/api/request"
	"backend/api/response"
	"backend/domain"
	"backend/services"
)

type ProjectHandler struct {
	projects *services.ProjectService
}

type projectListResponse struct {
	Items      []domain.Project `json:"items"`
	NextCursor *string          `json:"nextCursor"`
}

type projectResponse struct {
	Project domain.Project `json:"project"`
}

type createProjectRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
}

func NewProjectHandler(projectService *services.ProjectService) ProjectHandler {
	return ProjectHandler{projects: projectService}
}

func (handler ProjectHandler) List(writer http.ResponseWriter, request *http.Request) {
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
	items, nextCursor, listErr := handler.projects.ListProjects(request.Context(), auth.User.ID, workspaceID, apirequest.Limit(request), apirequest.OptionalCursor(request))
	if listErr != nil {
		response.WriteError(writer, request, listErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, projectListResponse{Items: items, NextCursor: apirequest.NullableCursor(nextCursor)})
}

func (handler ProjectHandler) Create(writer http.ResponseWriter, request *http.Request) {
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
	var payload createProjectRequest
	if decodeErr := response.DecodeJSON(request, &payload); decodeErr != nil {
		response.WriteError(writer, request, decodeErr)
		return
	}
	project, createErr := handler.projects.CreateProject(request.Context(), auth.User.ID, workspaceID, payload.Name, payload.Description)
	if createErr != nil {
		response.WriteError(writer, request, createErr)
		return
	}
	response.WriteJSON(writer, http.StatusCreated, projectResponse{Project: project})
}

func (handler ProjectHandler) Get(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	projectID, parseErr := apirequest.UUIDParam(request, "projectId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	project, getErr := handler.projects.GetProject(request.Context(), auth.User.ID, projectID)
	if getErr != nil {
		response.WriteError(writer, request, getErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, projectResponse{Project: project})
}

func (handler ProjectHandler) Update(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	projectID, parseErr := apirequest.UUIDParam(request, "projectId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	patch, patchErr := apirequest.DecodeProjectPatch(request)
	if patchErr != nil {
		response.WriteError(writer, request, patchErr)
		return
	}
	project, updateErr := handler.projects.UpdateProject(request.Context(), auth.User.ID, projectID, patch)
	if updateErr != nil {
		response.WriteError(writer, request, updateErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, projectResponse{Project: project})
}

func (handler ProjectHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	projectID, parseErr := apirequest.UUIDParam(request, "projectId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	if deleteErr := handler.projects.DeleteProject(request.Context(), auth.User.ID, projectID); deleteErr != nil {
		response.WriteError(writer, request, deleteErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}
