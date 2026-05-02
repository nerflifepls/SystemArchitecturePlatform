package api

import (
	"net/http"
	"strconv"

	"backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func parseUUIDParam(request *http.Request, name string) (uuid.UUID, error) {
	value := chi.URLParam(request, name)
	parsedValue, parseErr := uuid.Parse(value)
	if parseErr != nil {
		return uuid.Nil, services.BadRequest(name + " must be a valid UUID")
	}
	return parsedValue, nil
}

func parseLimit(request *http.Request) int {
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

func optionalCursor(request *http.Request) string {
	return request.URL.Query().Get("cursor")
}

func nullableCursor(cursor string) *string {
	if cursor == "" {
		return nil
	}
	return &cursor
}
