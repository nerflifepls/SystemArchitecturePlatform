package request

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/services"
)

func TestDecodeProjectPatch(t *testing.T) {
	tests := []struct {
		name           string
		body           string
		wantName       *string
		wantDesc       *string
		wantDescSet    bool
		wantServiceErr bool
	}{
		{
			name:        "name and description",
			body:        `{"name":"Design API","description":"Bounded context"}`,
			wantName:    ptr("Design API"),
			wantDesc:    ptr("Bounded context"),
			wantDescSet: true,
		},
		{
			name:        "description null",
			body:        `{"description":null}`,
			wantDescSet: true,
		},
		{
			name:           "invalid name type",
			body:           `{"name":42}`,
			wantServiceErr: true,
		},
		{
			name:           "invalid json",
			body:           `{`,
			wantServiceErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPatch, "/projects/1", strings.NewReader(test.body))
			patch, err := DecodeProjectPatch(request)
			if test.wantServiceErr {
				var serviceErr *services.Error
				if !errors.As(err, &serviceErr) {
					t.Fatalf("expected service error, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("DecodeProjectPatch returned error: %v", err)
			}
			if stringValue(patch.Name) != stringValue(test.wantName) {
				t.Fatalf("Name = %q, want %q", stringValue(patch.Name), stringValue(test.wantName))
			}
			if stringValue(patch.Description) != stringValue(test.wantDesc) {
				t.Fatalf("Description = %q, want %q", stringValue(patch.Description), stringValue(test.wantDesc))
			}
			if patch.DescriptionSet != test.wantDescSet {
				t.Fatalf("DescriptionSet = %v, want %v", patch.DescriptionSet, test.wantDescSet)
			}
		})
	}
}

func TestRequiredIntHeader(t *testing.T) {
	request := httptest.NewRequest(http.MethodPut, "/diagrams/1/snapshot", nil)
	request.Header.Set("X-Base-Update-Seq", "42")

	value, err := RequiredIntHeader(request, "X-Base-Update-Seq")
	if err != nil {
		t.Fatalf("RequiredIntHeader returned error: %v", err)
	}
	if value != 42 {
		t.Fatalf("value = %d, want 42", value)
	}
}

func TestRequiredIntHeaderRejectsMissingOrInvalidValues(t *testing.T) {
	tests := []struct {
		name  string
		value string
	}{
		{name: "missing"},
		{name: "invalid", value: "not-a-number"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPut, "/diagrams/1/snapshot", nil)
			if test.value != "" {
				request.Header.Set("X-Base-Update-Seq", test.value)
			}
			_, err := RequiredIntHeader(request, "X-Base-Update-Seq")
			var serviceErr *services.Error
			if !errors.As(err, &serviceErr) {
				t.Fatalf("expected service error, got %v", err)
			}
		})
	}
}

func TestLimitedBodyRejectsOversizedPayloads(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/diagrams/1/updates", strings.NewReader("abcd"))
	writer := httptest.NewRecorder()

	_, err := LimitedBody(writer, request, 2)
	var serviceErr *services.Error
	if !errors.As(err, &serviceErr) {
		t.Fatalf("expected service error, got %v", err)
	}
}

func ptr(value string) *string {
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
