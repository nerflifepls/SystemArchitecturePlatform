package services

import "net/http"

type Error struct {
	Code    string
	Message string
	Details any
	Status  int
}

func (serviceError *Error) Error() string {
	return serviceError.Message
}

func Unavailable(message string) *Error {
	return &Error{Code: "service_unavailable", Message: message, Status: http.StatusServiceUnavailable}
}

func Unauthorized(message string) *Error {
	return &Error{Code: "unauthorized", Message: message, Status: http.StatusUnauthorized}
}

func Forbidden(message string) *Error {
	return &Error{Code: "forbidden", Message: message, Status: http.StatusForbidden}
}

func NotFound(message string) *Error {
	return &Error{Code: "not_found", Message: message, Status: http.StatusNotFound}
}

func Conflict(message string) *Error {
	return &Error{Code: "conflict", Message: message, Status: http.StatusConflict}
}

func Validation(message string, details any) *Error {
	return &Error{Code: "validation_error", Message: message, Details: details, Status: http.StatusUnprocessableEntity}
}

func BadRequest(message string) *Error {
	return &Error{Code: "bad_request", Message: message, Status: http.StatusBadRequest}
}

func PayloadTooLarge(message string) *Error {
	return &Error{Code: "payload_too_large", Message: message, Status: http.StatusRequestEntityTooLarge}
}

func Internal(message string) *Error {
	return &Error{Code: "internal_error", Message: message, Status: http.StatusInternalServerError}
}
