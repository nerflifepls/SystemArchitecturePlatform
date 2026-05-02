package api

import (
	"encoding/json"
	"net/http"

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

func (handler ProjectHandler) List(writer http.ResponseWriter, request *http.Request) {
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
	items, nextCursor, listErr := handler.projects.ListProjects(request.Context(), auth.User.ID, workspaceID, parseLimit(request), optionalCursor(request))
	if listErr != nil {
		writeError(writer, request, listErr)
		return
	}
	writeJSON(writer, http.StatusOK, projectListResponse{Items: items, NextCursor: nullableCursor(nextCursor)})
}

func (handler ProjectHandler) Create(writer http.ResponseWriter, request *http.Request) {
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
	var payload createProjectRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	project, createErr := handler.projects.CreateProject(request.Context(), auth.User.ID, workspaceID, payload.Name, payload.Description)
	if createErr != nil {
		writeError(writer, request, createErr)
		return
	}
	writeJSON(writer, http.StatusCreated, projectResponse{Project: project})
}

func (handler ProjectHandler) Get(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	projectID, parseErr := parseUUIDParam(request, "projectId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	project, getErr := handler.projects.GetProject(request.Context(), auth.User.ID, projectID)
	if getErr != nil {
		writeError(writer, request, getErr)
		return
	}
	writeJSON(writer, http.StatusOK, projectResponse{Project: project})
}

func (handler ProjectHandler) Update(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	projectID, parseErr := parseUUIDParam(request, "projectId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	patch, patchErr := decodeProjectPatch(request)
	if patchErr != nil {
		writeError(writer, request, patchErr)
		return
	}
	project, updateErr := handler.projects.UpdateProject(request.Context(), auth.User.ID, projectID, patch)
	if updateErr != nil {
		writeError(writer, request, updateErr)
		return
	}
	writeJSON(writer, http.StatusOK, projectResponse{Project: project})
}

func (handler ProjectHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	projectID, parseErr := parseUUIDParam(request, "projectId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	if deleteErr := handler.projects.DeleteProject(request.Context(), auth.User.ID, projectID); deleteErr != nil {
		writeError(writer, request, deleteErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func decodeProjectPatch(request *http.Request) (services.ProjectPatch, error) {
	var rawPayload map[string]json.RawMessage
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if decodeErr := decoder.Decode(&rawPayload); decodeErr != nil {
		return services.ProjectPatch{}, services.BadRequest("request body must be valid JSON")
	}
	patch := services.ProjectPatch{}
	if rawName, exists := rawPayload["name"]; exists {
		var name string
		if unmarshalErr := json.Unmarshal(rawName, &name); unmarshalErr != nil {
			return services.ProjectPatch{}, services.BadRequest("name must be a string")
		}
		patch.Name = &name
	}
	if rawDescription, exists := rawPayload["description"]; exists {
		patch.DescriptionSet = true
		if string(rawDescription) != "null" {
			var description string
			if unmarshalErr := json.Unmarshal(rawDescription, &description); unmarshalErr != nil {
				return services.ProjectPatch{}, services.BadRequest("description must be a string or null")
			}
			patch.Description = &description
		}
	}
	return patch, nil
}
