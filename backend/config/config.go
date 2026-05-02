package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

const defaultSessionTTL = 30 * 24 * time.Hour

type Config struct {
	Port                 string
	DatabaseURL          string
	RedisAddr            string
	GoogleClientID       string
	SessionCookieName    string
	SessionTTL           time.Duration
	SessionCookieSecure  bool
	FrontendOrigin       string
	BackendInternalToken string
	LiveEventsPublicURL  string
}

func Load() (Config, error) {
	loadedConfig := Config{
		Port:                envOrDefault("PORT", "8081"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		RedisAddr:           os.Getenv("REDIS_ADDR"),
		GoogleClientID:      os.Getenv("GOOGLE_CLIENT_ID"),
		SessionCookieName:   envOrDefault("SESSION_COOKIE_NAME", "sid"),
		SessionTTL:          defaultSessionTTL,
		FrontendOrigin:      os.Getenv("FRONTEND_ORIGIN"),
		LiveEventsPublicURL: envOrDefault("LIVE_EVENTS_PUBLIC_URL", "ws://localhost:8080/ws"),
	}

	if rawSessionTTL := os.Getenv("SESSION_TTL"); rawSessionTTL != "" {
		parsedTTL, parseErr := parseDuration(rawSessionTTL)
		if parseErr != nil {
			return Config{}, fmt.Errorf("parse SESSION_TTL: %w", parseErr)
		}
		loadedConfig.SessionTTL = parsedTTL
	}

	if rawSecure := os.Getenv("SESSION_COOKIE_SECURE"); rawSecure != "" {
		parsedSecure, parseErr := strconv.ParseBool(rawSecure)
		if parseErr != nil {
			return Config{}, fmt.Errorf("parse SESSION_COOKIE_SECURE: %w", parseErr)
		}
		loadedConfig.SessionCookieSecure = parsedSecure
	}

	loadedConfig.BackendInternalToken = os.Getenv("BACKEND_INTERNAL_TOKEN")
	return loadedConfig, nil
}

func envOrDefault(name string, fallback string) string {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	return value
}

func parseDuration(rawValue string) (time.Duration, error) {
	parsedDuration, parseErr := time.ParseDuration(rawValue)
	if parseErr == nil {
		return parsedDuration, nil
	}

	seconds, secondsErr := strconv.Atoi(rawValue)
	if secondsErr != nil {
		return 0, parseErr
	}
	return time.Duration(seconds) * time.Second, nil
}
