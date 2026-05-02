// Package authz authorizes realtime diagram access through the backend internal API.
package authz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrBadRequest   = errors.New("authorization request is invalid")
	ErrForbidden    = errors.New("diagram access is forbidden")
	ErrUnavailable  = errors.New("authorization service is unavailable")
	ErrUnauthorized = errors.New("authorization credentials are invalid")
)

// Client calls the backend internal authorization API.
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

// Result is the backend authorization response for a diagram join request.
type Result struct {
	Allowed bool    `json:"allowed"`
	Role    string  `json:"role"`
	Diagram Diagram `json:"diagram"`
	User    User    `json:"user"`
}

// Diagram identifies the authorized diagram and its parent resources.
type Diagram struct {
	ID          string `json:"id"`
	ProjectID   string `json:"projectId"`
	WorkspaceID string `json:"workspaceId"`
}

// User describes the authorized user returned by the backend.
type User struct {
	ID        string  `json:"id"`
	Email     string  `json:"email"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

// NewClient validates backend connection settings and returns an authorization client.
func NewClient(baseURL string, token string, httpClient *http.Client) (*Client, error) {
	trimmedURL := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsedURL, parseErr := url.Parse(trimmedURL)
	if parseErr != nil {
		return nil, parseErr
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return nil, fmt.Errorf("base URL scheme must be http or https")
	}
	if parsedURL.Host == "" {
		return nil, fmt.Errorf("base URL host is required")
	}

	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}

	return &Client{baseURL: parsedURL.String(), token: strings.TrimSpace(token), httpClient: httpClient}, nil
}

// AuthorizeDiagram verifies whether a user can join a diagram realtime session.
func (client *Client) AuthorizeDiagram(ctx context.Context, diagramID uuid.UUID, userID uuid.UUID) (Result, error) {
	if client == nil || client.httpClient == nil {
		return Result{}, ErrUnavailable
	}
	if client.token == "" {
		return Result{}, ErrUnavailable
	}

	requestURL := client.baseURL + "/internal/v1/diagrams/" + url.PathEscape(diagramID.String()) + "/authorize?userId=" + url.QueryEscape(userID.String())
	request, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if requestErr != nil {
		return Result{}, ErrUnavailable
	}
	request.Header.Set("Authorization", "Bearer "+client.token)
	request.Header.Set("Accept", "application/json")

	response, doErr := client.httpClient.Do(request)
	if doErr != nil {
		return Result{}, ErrUnavailable
	}
	defer func() { _ = response.Body.Close() }()

	switch response.StatusCode {
	case http.StatusOK:
		var result Result
		if decodeErr := json.NewDecoder(response.Body).Decode(&result); decodeErr != nil {
			return Result{}, ErrUnavailable
		}
		if !result.Allowed {
			return Result{}, ErrForbidden
		}
		return result, nil
	case http.StatusBadRequest:
		_, _ = io.Copy(io.Discard, response.Body)
		return Result{}, ErrBadRequest
	case http.StatusForbidden, http.StatusNotFound:
		_, _ = io.Copy(io.Discard, response.Body)
		return Result{}, ErrForbidden
	case http.StatusUnauthorized:
		_, _ = io.Copy(io.Discard, response.Body)
		return Result{}, ErrUnauthorized
	default:
		_, _ = io.Copy(io.Discard, response.Body)
		return Result{}, ErrUnavailable
	}
}
