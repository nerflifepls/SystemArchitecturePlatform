package request

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func UUIDParam(request *http.Request, name string) (uuid.UUID, error) {
	value := chi.URLParam(request, name)
	parsedValue, parseErr := uuid.Parse(value)
	if parseErr != nil {
		return uuid.Nil, services.BadRequest(name + " must be a valid UUID")
	}
	return parsedValue, nil
}

func Limit(request *http.Request) int {
	value := request.URL.Query().Get("limit")
	if value == "" {
		return 50
	}
	parsedValue, parseErr := strconv.Atoi(value)
	if parseErr != nil {
		return 50
	}
	return parsedValue
}

func OptionalCursor(request *http.Request) string {
	return request.URL.Query().Get("cursor")
}

func NullableCursor(cursor string) *string {
	if cursor == "" {
		return nil
	}
	return &cursor
}

func RequiredIntHeader(request *http.Request, name string) (int64, error) {
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

func LimitedBody(writer http.ResponseWriter, request *http.Request, maxBytes int64) ([]byte, error) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxBytes)
	bodyBytes, readErr := io.ReadAll(request.Body)
	if readErr != nil {
		return nil, services.PayloadTooLarge("request body is too large")
	}
	return bodyBytes, nil
}

func DecodeProjectPatch(request *http.Request) (services.ProjectPatch, error) {
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
