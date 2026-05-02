package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"backend/services"

	"github.com/go-chi/chi/v5/middleware"
)

type errorBody struct {
	Error errorPayload `json:"error"`
}

type errorPayload struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Details   any    `json:"details"`
	RequestID string `json:"requestId"`
}

func writeJSON(writer http.ResponseWriter, statusCode int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(statusCode)
	if payload == nil {
		return
	}
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, request *http.Request, err error) {
	var serviceError *services.Error
	if !errors.As(err, &serviceError) {
		serviceError = services.Internal("unexpected error")
	}
	writeJSON(writer, serviceError.Status, errorBody{Error: errorPayload{
		Code:      serviceError.Code,
		Message:   serviceError.Message,
		Details:   serviceError.Details,
		RequestID: middleware.GetReqID(request.Context()),
	}})
}

func decodeJSON(request *http.Request, payload any) error {
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if decodeErr := decoder.Decode(payload); decodeErr != nil {
		return services.BadRequest("request body must be valid JSON")
	}
	return nil
}
