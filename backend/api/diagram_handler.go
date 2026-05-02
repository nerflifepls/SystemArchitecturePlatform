package api

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

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

func (handler DiagramHandler) List(writer http.ResponseWriter, request *http.Request) {
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
	items, nextCursor, listErr := handler.diagrams.ListDiagrams(request.Context(), auth.User.ID, projectID, parseLimit(request), optionalCursor(request))
	if listErr != nil {
		writeError(writer, request, listErr)
		return
	}
	writeJSON(writer, http.StatusOK, diagramListResponse{Items: items, NextCursor: nullableCursor(nextCursor)})
}

func (handler DiagramHandler) Create(writer http.ResponseWriter, request *http.Request) {
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
	var payload diagramRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	diagram, createErr := handler.diagrams.CreateDiagram(request.Context(), auth.User.ID, projectID, payload.Title)
	if createErr != nil {
		writeError(writer, request, createErr)
		return
	}
	writeJSON(writer, http.StatusCreated, diagramResponse{Diagram: diagram, Sync: handler.sync(diagram.ID)})
}

func (handler DiagramHandler) Get(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := parseUUIDParam(request, "diagramId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	diagram, role, getErr := handler.diagrams.GetDiagram(request.Context(), auth.User.ID, diagramID)
	if getErr != nil {
		writeError(writer, request, getErr)
		return
	}
	writeJSON(writer, http.StatusOK, diagramResponse{Diagram: diagram, Sync: handler.sync(diagram.ID), Role: role})
}

func (handler DiagramHandler) Update(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := parseUUIDParam(request, "diagramId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	var payload diagramRequest
	if decodeErr := decodeJSON(request, &payload); decodeErr != nil {
		writeError(writer, request, decodeErr)
		return
	}
	diagram, updateErr := handler.diagrams.UpdateDiagram(request.Context(), auth.User.ID, diagramID, payload.Title)
	if updateErr != nil {
		writeError(writer, request, updateErr)
		return
	}
	writeJSON(writer, http.StatusOK, diagramResponse{Diagram: diagram, Sync: handler.sync(diagram.ID)})
}

func (handler DiagramHandler) Delete(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := parseUUIDParam(request, "diagramId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	if deleteErr := handler.diagrams.DeleteDiagram(request.Context(), auth.User.ID, diagramID); deleteErr != nil {
		writeError(writer, request, deleteErr)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (handler DiagramHandler) GetSnapshot(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := parseUUIDParam(request, "diagramId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	diagram, snapshotErr := handler.diagrams.GetSnapshot(request.Context(), auth.User.ID, diagramID)
	if snapshotErr != nil {
		writeError(writer, request, snapshotErr)
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
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := parseUUIDParam(request, "diagramId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	baseUpdateSeq, baseErr := parseRequiredIntHeader(request, "X-Base-Update-Seq")
	if baseErr != nil {
		writeError(writer, request, baseErr)
		return
	}
	snapshotBytes, readErr := readLimitedBody(writer, request, maxSnapshotBytes)
	if readErr != nil {
		writeError(writer, request, readErr)
		return
	}
	result, saveErr := handler.diagrams.SaveSnapshot(request.Context(), auth.User.ID, diagramID, baseUpdateSeq, snapshotBytes)
	if saveErr != nil {
		writeError(writer, request, saveErr)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (handler DiagramHandler) ListUpdates(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := parseUUIDParam(request, "diagramId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	afterSeq := int64(-1)
	if rawAfterSeq := request.URL.Query().Get("afterSeq"); rawAfterSeq != "" {
		parsedAfterSeq, afterErr := strconv.ParseInt(rawAfterSeq, 10, 64)
		if afterErr != nil {
			writeError(writer, request, services.BadRequest("afterSeq must be an integer"))
			return
		}
		afterSeq = parsedAfterSeq
	}
	updates, lastUpdateSeq, listErr := handler.diagrams.ListUpdates(request.Context(), auth.User.ID, diagramID, afterSeq)
	if listErr != nil {
		writeError(writer, request, listErr)
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
	writeJSON(writer, http.StatusOK, diagramUpdatesResponse{Items: responseItems, LastUpdateSeq: lastUpdateSeq})
}

func (handler DiagramHandler) AppendUpdate(writer http.ResponseWriter, request *http.Request) {
	auth, ok := currentAuth(request.Context())
	if !ok {
		writeError(writer, request, services.Unauthorized("session is required"))
		return
	}
	diagramID, parseErr := parseUUIDParam(request, "diagramId")
	if parseErr != nil {
		writeError(writer, request, parseErr)
		return
	}
	updateID, updateIDErr := uuid.Parse(strings.TrimSpace(request.Header.Get("X-Update-Id")))
	if updateIDErr != nil {
		writeError(writer, request, services.BadRequest("X-Update-Id must be a valid UUID"))
		return
	}
	clientID := request.Header.Get("X-Client-Id")
	updateBytes, readErr := readLimitedBody(writer, request, maxUpdateBytes)
	if readErr != nil {
		writeError(writer, request, readErr)
		return
	}
	update, duplicate, appendErr := handler.diagrams.AppendUpdate(request.Context(), auth.User.ID, diagramID, updateID, clientID, updateBytes)
	if appendErr != nil {
		writeError(writer, request, appendErr)
		return
	}
	statusCode := http.StatusCreated
	if duplicate {
		statusCode = http.StatusOK
	}
	writeJSON(writer, statusCode, appendUpdateResponse{Seq: update.Seq, UpdateID: update.UpdateID.String(), AcceptedAt: update.CreatedAt})
}

func (handler DiagramHandler) sync(diagramID uuid.UUID) *syncResponse {
	return &syncResponse{
		SnapshotURL:  "/api/v1/diagrams/" + diagramID.String() + "/snapshot",
		UpdatesURL:   "/api/v1/diagrams/" + diagramID.String() + "/updates",
		WebsocketURL: appendDiagramQuery(handler.config.LiveEventsPublicURL, diagramID),
	}
}

func parseRequiredIntHeader(request *http.Request, name string) (int64, error) {
	value := strings.TrimSpace(request.Header.Get(name))
	if value == "" {
		return 0, services.BadRequest(name + " is required")
	}
	parsedValue, parseErr := strconv.ParseInt(value, 10, 64)
	if parseErr != nil {
		return 0, services.BadRequest(name + " must be an integer")
	}
	return parsedValue, nil
}

func readLimitedBody(writer http.ResponseWriter, request *http.Request, maxBytes int64) ([]byte, error) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxBytes)
	bodyBytes, readErr := io.ReadAll(request.Body)
	if readErr != nil {
		return nil, services.PayloadTooLarge("request body is too large")
	}
	return bodyBytes, nil
}

func appendDiagramQuery(baseURL string, diagramID uuid.UUID) string {
	separator := "?"
	if strings.Contains(baseURL, "?") {
		separator = "&"
	}
	return baseURL + separator + "diagramId=" + diagramID.String()
}
