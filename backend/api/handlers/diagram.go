package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/api/authctx"
	apirequest "backend/api/request"
	"backend/api/response"
	"backend/config"
	"backend/domain"
	"backend/services"

	"github.com/google/uuid"
)

const maxSnapshotBytes = 10 << 20
const maxUpdateBytes = 1 << 20

type DiagramHandler struct {
	config   config.Config
	diagrams *services.DiagramService
}

type diagramListResponse struct {
	Items      []domain.Diagram `json:"items"`
	NextCursor *string          `json:"nextCursor"`
}

type diagramResponse struct {
	Diagram domain.Diagram `json:"diagram"`
	Sync    *syncResponse  `json:"sync,omitempty"`
	Role    domain.Role    `json:"role,omitempty"`
}

type syncResponse struct {
	SnapshotURL  string `json:"snapshotUrl"`
	UpdatesURL   string `json:"updatesUrl"`
	WebsocketURL string `json:"websocketUrl"`
}

type diagramRequest struct {
	Title string `json:"title"`
}

type diagramUpdatesResponse struct {
	Items         []diagramUpdateResponse `json:"items"`
	LastUpdateSeq int64                   `json:"lastUpdateSeq"`
}

type diagramUpdateResponse struct {
	Seq          int64     `json:"seq"`
	UpdateID     string    `json:"updateId"`
	ClientID     string    `json:"clientId"`
	AuthorUserID string    `json:"authorUserId"`
	UpdateBase64 string    `json:"updateBase64"`
	CreatedAt    time.Time `json:"createdAt"`
}

type appendUpdateResponse struct {
	Seq        int64     `json:"seq"`
	UpdateID   string    `json:"updateId"`
	AcceptedAt time.Time `json:"acceptedAt"`
}

func NewDiagramHandler(appConfig config.Config, diagramService *services.DiagramService) DiagramHandler {
	return DiagramHandler{config: appConfig, diagrams: diagramService}
}

func (handler DiagramHandler) List(writer http.ResponseWriter, request *http.Request) {
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
	items, nextCursor, listErr := handler.diagrams.ListDiagrams(request.Context(), auth.User.ID, projectID, apirequest.Limit(request), apirequest.OptionalCursor(request))
	if listErr != nil {
		response.WriteError(writer, request, listErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, diagramListResponse{Items: items, NextCursor: apirequest.NullableCursor(nextCursor)})
}

func (handler DiagramHandler) Create(writer http.ResponseWriter, request *http.Request) {
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
	var payload diagramRequest
	if decodeErr := response.DecodeJSON(request, &payload); decodeErr != nil {
		response.WriteError(writer, request, decodeErr)
		return
	}
	diagram, createErr := handler.diagrams.CreateDiagram(request.Context(), auth.User.ID, projectID, payload.Title)
	if createErr != nil {
		response.WriteError(writer, request, createErr)
		return
	}
	response.WriteJSON(writer, http.StatusCreated, diagramResponse{Diagram: diagram, Sync: handler.sync(diagram.ID)})
}

func (handler DiagramHandler) Get(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	diagram, role, getErr := handler.diagrams.GetDiagram(request.Context(), auth.User.ID, diagramID)
	if getErr != nil {
		response.WriteError(writer, request, getErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, diagramResponse{Diagram: diagram, Sync: handler.sync(diagram.ID), Role: role})
}

func (handler DiagramHandler) Update(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	var payload diagramRequest
	if decodeErr := response.DecodeJSON(request, &payload); decodeErr != nil {
		response.WriteError(writer, request, decodeErr)
		return
	}
	diagram, updateErr := handler.diagrams.UpdateDiagram(request.Context(), auth.User.ID, diagramID, payload.Title)
	if updateErr != nil {
		response.WriteError(writer, request, updateErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, diagramResponse{Diagram: diagram, Sync: handler.sync(diagram.ID)})
}

func (handler DiagramHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	if deleteErr := handler.diagrams.DeleteDiagram(request.Context(), auth.User.ID, diagramID); deleteErr != nil {
		response.WriteError(writer, request, deleteErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler DiagramHandler) GetSnapshot(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	diagram, snapshotErr := handler.diagrams.GetSnapshot(request.Context(), auth.User.ID, diagramID)
	if snapshotErr != nil {
		response.WriteError(writer, request, snapshotErr)
		return
	}
	snapshotBytes := diagram.SnapshotBytes
	if len(snapshotBytes) == 0 {
		snapshotBytes = services.EmptyYjsSnapshot
	}
	writer.Header().Set("Content-Type", "application/octet-stream")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Snapshot-Version", strconv.FormatInt(diagram.SnapshotVersion, 10))
	writer.Header().Set("X-Last-Update-Seq", strconv.FormatInt(diagram.LastUpdateSeq, 10))
	writer.Header().Set("ETag", fmt.Sprintf(`W/"%s-%d-%d"`, diagram.ID.String(), diagram.SnapshotVersion, diagram.LastUpdateSeq))
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(snapshotBytes)
}

func (handler DiagramHandler) SaveSnapshot(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	baseUpdateSeq, baseErr := apirequest.RequiredIntHeader(request, "X-Base-Update-Seq")
	if baseErr != nil {
		response.WriteError(writer, request, baseErr)
		return
	}
	snapshotBytes, readErr := apirequest.LimitedBody(writer, request, maxSnapshotBytes)
	if readErr != nil {
		response.WriteError(writer, request, readErr)
		return
	}
	result, saveErr := handler.diagrams.SaveSnapshot(request.Context(), auth.User.ID, diagramID, baseUpdateSeq, snapshotBytes)
	if saveErr != nil {
		response.WriteError(writer, request, saveErr)
		return
	}
	response.WriteJSON(writer, http.StatusOK, result)
}

func (handler DiagramHandler) ListUpdates(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	afterSeq := int64(-1)
	if rawAfterSeq := request.URL.Query().Get("afterSeq"); rawAfterSeq != "" {
		parsedAfterSeq, afterErr := strconv.ParseInt(rawAfterSeq, 10, 64)
		if afterErr != nil {
			response.WriteError(writer, request, services.BadRequest("afterSeq must be an integer"))
			return
		}
		afterSeq = parsedAfterSeq
	}
	updates, lastUpdateSeq, listErr := handler.diagrams.ListUpdates(request.Context(), auth.User.ID, diagramID, afterSeq)
	if listErr != nil {
		response.WriteError(writer, request, listErr)
		return
	}
	responseItems := make([]diagramUpdateResponse, 0, len(updates))
	for _, update := range updates {
		responseItems = append(responseItems, diagramUpdateResponse{
			Seq:          update.Seq,
			UpdateID:     update.UpdateID.String(),
			ClientID:     update.ClientID,
			AuthorUserID: update.AuthorUserID.String(),
			UpdateBase64: base64.StdEncoding.EncodeToString(update.UpdateBytes),
			CreatedAt:    update.CreatedAt,
		})
	}
	response.WriteJSON(writer, http.StatusOK, diagramUpdatesResponse{Items: responseItems, LastUpdateSeq: lastUpdateSeq})
}

func (handler DiagramHandler) AppendUpdate(writer http.ResponseWriter, request *http.Request) {
	auth, ok := authctx.Current(request.Context())
	if !ok {
		response.WriteError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := apirequest.UUIDParam(request, "diagramId")
	if parseErr != nil {
		response.WriteError(writer, request, parseErr)
		return
	}
	updateID, updateIDErr := uuid.Parse(strings.TrimSpace(request.Header.Get("X-Update-Id")))
	if updateIDErr != nil {
		response.WriteError(writer, request, services.BadRequest("X-Update-Id must be a valid UUID"))
		return
	}
	clientID := request.Header.Get("X-Client-Id")
	updateBytes, readErr := apirequest.LimitedBody(writer, request, maxUpdateBytes)
	if readErr != nil {
		response.WriteError(writer, request, readErr)
		return
	}
	update, duplicate, appendErr := handler.diagrams.AppendUpdate(request.Context(), auth.User.ID, diagramID, updateID, clientID, updateBytes)
	if appendErr != nil {
		response.WriteError(writer, request, appendErr)
		return
	}
	statusCode := http.StatusCreated
	if duplicate {
		statusCode = http.StatusOK
	}
	response.WriteJSON(writer, statusCode, appendUpdateResponse{Seq: update.Seq, UpdateID: update.UpdateID.String(), AcceptedAt: update.CreatedAt})
}

func (handler DiagramHandler) sync(diagramID uuid.UUID) *syncResponse {
	return &syncResponse{
		SnapshotURL:  "/api/v1/diagrams/" + diagramID.String() + "/snapshot",
		UpdatesURL:   "/api/v1/diagrams/" + diagramID.String() + "/updates",
		WebsocketURL: appendDiagramQuery(handler.config.LiveEventsPublicURL, diagramID),
	}
}

func appendDiagramQuery(baseURL string, diagramID uuid.UUID) string {
	separator := "?"
	if strings.Contains(baseURL, "?") {
		separator = "&"
	}
	return baseURL + separator + "diagramId=" + diagramID.String()
}
