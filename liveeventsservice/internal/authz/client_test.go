package authz

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestAuthorizeDiagramSendsBearerTokenAndUserID(t *testing.T) {
	diagramID := uuid.New()
	userID := uuid.New()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/v1/diagrams/"+diagramID.String()+"/authorize" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		if request.URL.Query().Get("userId") != userID.String() {
			t.Fatalf("unexpected userId query: %s", request.URL.RawQuery)
		}
		if request.Header.Get("Authorization") != "Bearer secret-token" {
			t.Fatalf("unexpected authorization header: %s", request.Header.Get("Authorization"))
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"allowed":true,"role":"editor","diagram":{"id":"` + diagramID.String() + `"},"user":{"id":"` + userID.String() + `"}}`))
	}))
	defer server.Close()

	client, clientErr := NewClient(server.URL, "secret-token", server.Client())
	if clientErr != nil {
		t.Fatalf("new client: %v", clientErr)
	}

	result, authErr := client.AuthorizeDiagram(context.Background(), diagramID, userID)
	if authErr != nil {
		t.Fatalf("authorize diagram: %v", authErr)
	}
	if !result.Allowed || result.Role != "editor" {
		t.Fatalf("unexpected authorization result: %+v", result)
	}
}

func TestAuthorizeDiagramMapsDeniedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"allowed":false}`))
	}))
	defer server.Close()

	client, clientErr := NewClient(server.URL, "secret-token", server.Client())
	if clientErr != nil {
		t.Fatalf("new client: %v", clientErr)
	}

	_, authErr := client.AuthorizeDiagram(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(authErr, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", authErr)
	}
}

func TestAuthorizeDiagramRequiresInternalToken(t *testing.T) {
	client, clientErr := NewClient("http://backend:8081", "", nil)
	if clientErr != nil {
		t.Fatalf("new client: %v", clientErr)
	}

	_, authErr := client.AuthorizeDiagram(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(authErr, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable, got %v", authErr)
	}
}
