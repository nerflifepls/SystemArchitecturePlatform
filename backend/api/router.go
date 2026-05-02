package api

import (
	"fmt"
	"net/http"

	"backend/config"
	"backend/services"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Dependencies struct {
	Config     config.Config
	Auth       *services.AuthService
	Workspaces *services.WorkspaceService
	Projects   *services.ProjectService
	Diagrams   *services.DiagramService
}

func NewRouter(deps Dependencies) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Logger)
	router.Use(middleware.Recoverer)
	router.Use(corsMiddleware(deps.Config.FrontendOrigin))

	router.HandleFunc("/", rootHandler)
	router.HandleFunc("/healthz", healthHandler)

	authHandler := AuthHandler{config: deps.Config, auth: deps.Auth}
	workspaceHandler := WorkspaceHandler{workspaces: deps.Workspaces}
	projectHandler := ProjectHandler{projects: deps.Projects}
	diagramHandler := DiagramHandler{config: deps.Config, diagrams: deps.Diagrams}
	internalHandler := InternalHandler{diagrams: deps.Diagrams}

	router.Route("/api/v1", func(apiRouter chi.Router) {
		apiRouter.Get("/", func(writer http.ResponseWriter, request *http.Request) {
			writeJSON(writer, http.StatusOK, map[string]string{"service": "backend", "version": "v1", "status": "ok"})
		})
		apiRouter.Post("/auth/google", authHandler.Google)
		apiRouter.Post("/auth/logout", authHandler.Logout)

		apiRouter.Group(func(protectedRouter chi.Router) {
			protectedRouter.Use(sessionMiddleware(deps.Auth, deps.Config))
			protectedRouter.Get("/auth/me", authHandler.Me)
			protectedRouter.Post("/auth/refresh", authHandler.Refresh)

			protectedRouter.Get("/workspaces", workspaceHandler.List)
			protectedRouter.Post("/workspaces", workspaceHandler.Create)
			protectedRouter.Get("/workspaces/{workspaceId}", workspaceHandler.Get)
			protectedRouter.Patch("/workspaces/{workspaceId}", workspaceHandler.Update)
			protectedRouter.Delete("/workspaces/{workspaceId}", workspaceHandler.Delete)
			protectedRouter.Get("/workspaces/{workspaceId}/members", workspaceHandler.ListMembers)
			protectedRouter.Post("/workspaces/{workspaceId}/members", workspaceHandler.AddMember)
			protectedRouter.Patch("/workspaces/{workspaceId}/members/{userId}", workspaceHandler.UpdateMember)
			protectedRouter.Delete("/workspaces/{workspaceId}/members/{userId}", workspaceHandler.RemoveMember)

			protectedRouter.Get("/workspaces/{workspaceId}/projects", projectHandler.List)
			protectedRouter.Post("/workspaces/{workspaceId}/projects", projectHandler.Create)
			protectedRouter.Get("/projects/{projectId}", projectHandler.Get)
			protectedRouter.Patch("/projects/{projectId}", projectHandler.Update)
			protectedRouter.Delete("/projects/{projectId}", projectHandler.Delete)

			protectedRouter.Get("/projects/{projectId}/diagrams", diagramHandler.List)
			protectedRouter.Post("/projects/{projectId}/diagrams", diagramHandler.Create)
			protectedRouter.Get("/diagrams/{diagramId}", diagramHandler.Get)
			protectedRouter.Patch("/diagrams/{diagramId}", diagramHandler.Update)
			protectedRouter.Delete("/diagrams/{diagramId}", diagramHandler.Delete)
			protectedRouter.Get("/diagrams/{diagramId}/snapshot", diagramHandler.GetSnapshot)
			protectedRouter.Put("/diagrams/{diagramId}/snapshot", diagramHandler.SaveSnapshot)
			protectedRouter.Get("/diagrams/{diagramId}/updates", diagramHandler.ListUpdates)
			protectedRouter.Post("/diagrams/{diagramId}/updates", diagramHandler.AppendUpdate)
		})
	})

	router.Route("/internal/v1", func(internalRouter chi.Router) {
		internalRouter.Use(internalTokenMiddleware(deps.Config))
		internalRouter.Get("/diagrams/{diagramId}/authorize", internalHandler.AuthorizeDiagram)
	})

	return router
}

func rootHandler(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(writer, `{"service":"backend","status":"ok"}`)
}

func healthHandler(writer http.ResponseWriter, request *http.Request) {
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write([]byte("ok"))
}
