package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/api"
	rediscache "backend/cache/redis"
	"backend/config"
	"backend/database/postgre"
	"backend/services"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
)

func main() {
	appConfig, configErr := config.Load()
	if configErr != nil {
		log.Fatalf("load config: %v", configErr)
	}

	bootstrapCtx := context.Background()
	repository, closeDatabase := connectDatabase(bootstrapCtx, appConfig.DatabaseURL)
	defer closeDatabase()
	sessionStore, eventPublisher, closeRedis := connectRedis(bootstrapCtx, appConfig.RedisAddr, appConfig.SessionTTL)
	defer closeRedis()

	var userRepository services.UserRepository
	var workspaceRepository services.WorkspaceRepository
	var projectRepository services.ProjectRepository
	var diagramRepository services.DiagramRepository
	if repository != nil {
		userRepository = repository
		workspaceRepository = repository
		projectRepository = repository
		diagramRepository = repository
	}

	authService := services.NewAuthService(userRepository, sessionStore, services.NewGoogleVerifier(), appConfig.GoogleClientID, appConfig.SessionTTL)
	workspaceService := services.NewWorkspaceService(workspaceRepository, userRepository, eventPublisher)
	projectService := services.NewProjectService(projectRepository, workspaceRepository, eventPublisher)
	diagramService := services.NewDiagramService(diagramRepository, projectRepository, workspaceRepository, eventPublisher)

	server := &http.Server{
		Addr:         ":" + appConfig.Port,
		Handler:      api.NewRouter(api.Dependencies{Config: appConfig, Auth: authService, Workspaces: workspaceService, Projects: projectService, Diagrams: diagramService}),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("backend listening on %s", server.Addr)
		if listenErr := server.ListenAndServe(); listenErr != nil && listenErr != http.ErrServerClosed {
			serverErr <- listenErr
		}
	}()

	select {
	case listenErr := <-serverErr:
		log.Fatalf("serve backend: %v", listenErr)
	case <-shutdownCtx.Done():
		log.Print("backend shutdown requested")
	}

	drainCtx, cancelDrain := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelDrain()
	if shutdownErr := server.Shutdown(drainCtx); shutdownErr != nil {
		log.Fatalf("shutdown backend: %v", shutdownErr)
	}
	log.Print("backend stopped")
}

func connectDatabase(ctx context.Context, databaseURL string) (*postgre.Repository, func()) {
	if databaseURL == "" {
		log.Print("DATABASE_URL is not set; database-backed endpoints will return 503")
		return nil, func() {}
	}
	connectCtx, cancelConnect := context.WithTimeout(ctx, 5*time.Second)
	defer cancelConnect()
	pool, connectErr := pgxpool.New(connectCtx, databaseURL)
	if connectErr != nil {
		log.Printf("connect PostgreSQL failed: %v; database-backed endpoints will return 503", connectErr)
		return nil, func() {}
	}
	if pingErr := pool.Ping(connectCtx); pingErr != nil {
		pool.Close()
		log.Printf("ping PostgreSQL failed: %v; database-backed endpoints will return 503", pingErr)
		return nil, func() {}
	}
	if migrationErr := postgre.RunMigrations(connectCtx, pool); migrationErr != nil {
		pool.Close()
		log.Printf("run PostgreSQL migrations failed: %v; database-backed endpoints will return 503", migrationErr)
		return nil, func() {}
	}
	log.Print("connected to PostgreSQL")
	return postgre.NewRepository(pool), pool.Close
}

func connectRedis(ctx context.Context, redisAddr string, sessionTTL time.Duration) (services.SessionStore, services.LiveEventPublisher, func()) {
	if redisAddr == "" {
		log.Print("REDIS_ADDR is not set; session-backed endpoints will return 503")
		return nil, nil, func() {}
	}
	client := goredis.NewClient(&goredis.Options{Addr: redisAddr})
	connectCtx, cancelConnect := context.WithTimeout(ctx, 5*time.Second)
	defer cancelConnect()
	if pingErr := client.Ping(connectCtx).Err(); pingErr != nil {
		_ = client.Close()
		log.Printf("ping Redis failed: %v; session-backed endpoints will return 503", pingErr)
		return nil, nil, func() {}
	}
	log.Print("connected to Redis")
	return rediscache.NewSessionStore(client, sessionTTL), rediscache.NewEventPublisher(client, log.Default()), func() { _ = client.Close() }
}
