package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("REDIS_ADDR", "")
	t.Setenv("BACKEND_INTERNAL_URL", "")
	t.Setenv("BACKEND_INTERNAL_TOKEN", "")
	t.Setenv("FRONTEND_ORIGIN", "")
	t.Setenv("SESSION_COOKIE_NAME", "")

	loadedConfig, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if loadedConfig.Port != "8080" {
		t.Fatalf("Port = %q, want 8080", loadedConfig.Port)
	}
	if loadedConfig.RedisAddr != "redis:6379" {
		t.Fatalf("RedisAddr = %q, want redis:6379", loadedConfig.RedisAddr)
	}
	if loadedConfig.BackendInternalURL != "http://backend:8081" {
		t.Fatalf("BackendInternalURL = %q, want http://backend:8081", loadedConfig.BackendInternalURL)
	}
	if loadedConfig.SessionCookieName != "sid" {
		t.Fatalf("SessionCookieName = %q, want sid", loadedConfig.SessionCookieName)
	}
}

func TestLoadTrimsOverrides(t *testing.T) {
	t.Setenv("PORT", " 9090 ")
	t.Setenv("REDIS_ADDR", " redis.local:6379 ")
	t.Setenv("BACKEND_INTERNAL_URL", " https://backend.local:8443/ ")
	t.Setenv("BACKEND_INTERNAL_TOKEN", " token ")
	t.Setenv("FRONTEND_ORIGIN", " http://localhost:5173 ")
	t.Setenv("SESSION_COOKIE_NAME", " platform_sid ")

	loadedConfig, err := Load()
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}

	if loadedConfig.Port != "9090" {
		t.Fatalf("Port = %q, want 9090", loadedConfig.Port)
	}
	if loadedConfig.RedisAddr != "redis.local:6379" {
		t.Fatalf("RedisAddr = %q, want redis.local:6379", loadedConfig.RedisAddr)
	}
	if loadedConfig.BackendInternalURL != "https://backend.local:8443" {
		t.Fatalf("BackendInternalURL = %q, want https://backend.local:8443", loadedConfig.BackendInternalURL)
	}
	if loadedConfig.BackendInternalToken != "token" {
		t.Fatalf("BackendInternalToken = %q, want token", loadedConfig.BackendInternalToken)
	}
	if loadedConfig.FrontendOrigin != "http://localhost:5173" {
		t.Fatalf("FrontendOrigin = %q, want http://localhost:5173", loadedConfig.FrontendOrigin)
	}
	if loadedConfig.SessionCookieName != "platform_sid" {
		t.Fatalf("SessionCookieName = %q, want platform_sid", loadedConfig.SessionCookieName)
	}
}

func TestLoadRejectsInvalidBackendURL(t *testing.T) {
	t.Setenv("BACKEND_INTERNAL_URL", "ftp://backend")

	_, err := Load()
	if err == nil {
		t.Fatal("Load returned nil error for invalid backend URL")
	}
}
