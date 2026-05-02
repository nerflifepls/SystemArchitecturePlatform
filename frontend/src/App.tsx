import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { useSession } from "./hooks/useAuth";
import { DashboardPage } from "./pages/DashboardPage";
import { DiagramEditorPage } from "./pages/DiagramEditorPage";
import { DiagramOverviewPage } from "./pages/DiagramOverviewPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { WorkspacePage } from "./pages/WorkspacePage";

function RequireAuth() {
	const location = useLocation();
	const sessionQuery = useSession();

	if (sessionQuery.isPending) {
		return (
			<div className="screen-center">
				<div className="status-panel">Checking session...</div>
			</div>
		);
	}

	if (!sessionQuery.data?.user) {
		return <Navigate to="/login" replace state={{ from: location.pathname }} />;
	}

	return <Outlet />;
}

export function App() {
	return (
		<Routes>
			<Route path="/login" element={<LoginPage />} />
			<Route element={<RequireAuth />}>
				<Route
					path="workspaces/:workspaceId/projects/:projectId/diagrams/:diagramId/editor"
					element={<DiagramEditorPage />}
				/>
				<Route element={<AppShell />}>
					<Route index element={<DashboardPage />} />
					<Route path="workspaces/:workspaceId" element={<WorkspacePage />} />
					<Route path="workspaces/:workspaceId/projects/:projectId" element={<ProjectPage />} />
					<Route
						path="workspaces/:workspaceId/projects/:projectId/diagrams/:diagramId"
						element={<DiagramOverviewPage />}
					/>
				</Route>
			</Route>
			<Route path="*" element={<NotFoundPage />} />
		</Routes>
	);
}
