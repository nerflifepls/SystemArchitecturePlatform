package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Port                 string
	RedisAddr            string
	BackendInternalURL   string
	BackendInternalToken string
	FrontendOrigin       string
	SessionCookieName    string
}

func Load() (Config, error) {
	loadedConfig := Config{
		Port:                 envOrDefault("PORT", "8080"),
		RedisAddr:            envOrDefault("REDIS_ADDR", "redis:6379"),
		BackendInternalURL:   envOrDefault("BACKEND_INTERNAL_URL", "http://backend:8081"),
		BackendInternalToken: strings.TrimSpace(os.Getenv("BACKEND_INTERNAL_TOKEN")),
		FrontendOrigin:       strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN")),
		SessionCookieName:    envOrDefault("SESSION_COOKIE_NAME", "sid"),
	}

	backendURL, parseErr := normalizeHTTPURL(loadedConfig.BackendInternalURL)
	if parseErr != nil {
		return Config{}, fmt.Errorf("parse BACKEND_INTERNAL_URL: %w", parseErr)
	}
	loadedConfig.BackendInternalURL = backendURL

	return loadedConfig, nil
}

func envOrDefault(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func normalizeHTTPURL(rawValue string) (string, error) {
	parsedURL, parseErr := url.Parse(strings.TrimRight(strings.TrimSpace(rawValue), "/"))
	if parseErr != nil {
		return "", parseErr
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return "", fmt.Errorf("scheme must be http or https")
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("host is required")
	}
	return parsedURL.String(), nil
}
