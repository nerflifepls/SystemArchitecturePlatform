package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"liveeventsservice/internal/authz"
	"liveeventsservice/internal/config"
	"liveeventsservice/internal/realtime"
	"liveeventsservice/internal/session"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

func main() {
	logger := log.New(os.Stdout, "liveeventsservice ", log.LstdFlags|log.LUTC)
	appConfig, configErr := config.Load()
	if configErr != nil {
		logger.Fatalf("load config: %v", configErr)
	}

	redisClient := goredis.NewClient(&goredis.Options{Addr: appConfig.RedisAddr})
	defer func() { _ = redisClient.Close() }()

	authzClient, authzErr := authz.NewClient(appConfig.BackendInternalURL, appConfig.BackendInternalToken, nil)
	if authzErr != nil {
		logger.Fatalf("create authz client: %v", authzErr)
	}

	hub := realtime.NewHub(redisClient, authzClient, uuid.NewString(), logger)
	eventHub := realtime.NewEventHub(redisClient, logger)
	realtimeHandler := realtime.NewHandler(appConfig, session.NewStore(redisClient), authzClient, hub, eventHub, logger)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(writer, "{\"service\":\"liveeventsservice\",\"status\":\"ok\"}")
	})
	mux.HandleFunc("/healthz", func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte("ok"))
	})
	mux.HandleFunc("/ws", realtimeHandler.ServeWS)

	address := ":" + appConfig.Port
	server := &http.Server{
		Addr:              address,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		logger.Printf("live events service listening on %s", address)
		serverErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if err != nil && err != http.ErrServerClosed {
			logger.Fatalf("serve: %v", err)
		}
	case <-shutdownCtx.Done():
		logger.Printf("shutdown signal received")
	}

	gracefulCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	hub.Close(gracefulCtx)
	eventHub.Close()
	if shutdownErr := server.Shutdown(gracefulCtx); shutdownErr != nil {
		logger.Printf("graceful shutdown failed: %v", shutdownErr)
		if closeErr := server.Close(); closeErr != nil {
			logger.Printf("force close failed: %v", closeErr)
		}
	}
}
