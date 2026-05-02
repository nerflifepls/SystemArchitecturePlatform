import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, LayoutDashboard, LogOut, Plus } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { API_BASE_URL } from "../api/client";
import { authApi, workspaceApi } from "../api/endpoints";
import { sessionQueryKey, useSession } from "../hooks/useAuth";

export function AppShell() {
	const sessionQuery = useSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const workspacesQuery = useQuery({
		queryKey: ["workspaces"],
		queryFn: ({ signal }) => workspaceApi.list(signal),
	});

	const signOutMutation = useMutation({
		mutationFn: () => authApi.signOut(),
		onSettled: () => {
			queryClient.setQueryData(sessionQueryKey, { user: null });
			navigate("/login");
		},
	});

	return (
		<div className="app-shell">
			<aside className="sidebar" aria-label="Primary">
				<div className="brand-block">
					<span className="brand-mark">SD</span>
					<div>
						<strong>System Design</strong>
						<span>Collaborative workspace</span>
					</div>
				</div>

				<nav className="nav-stack">
					<NavLink to="/" end className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
						<LayoutDashboard size={17} />
						<span>Dashboard</span>
					</NavLink>
					<div className="nav-heading">
						<span>Workspaces</span>
						<Plus size={14} />
					</div>
					{workspacesQuery.data?.map((workspace) => (
						<NavLink
							key={workspace.id}
							to={`/workspaces/${workspace.id}`}
							className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
						>
							<Boxes size={16} />
							<span>{workspace.name}</span>
						</NavLink>
					))}
				</nav>

				<div className="sidebar-footer">
					<span className="api-pill">API {API_BASE_URL}</span>
				</div>
			</aside>

			<div className="workspace-shell">
				<header className="topbar">
					<div>
						<span className="eyebrow">MVP workspace</span>
						<strong>{sessionQuery.data?.user?.name ?? sessionQuery.data?.user?.email}</strong>
					</div>
					<button className="icon-text-button" type="button" onClick={() => signOutMutation.mutate()}>
						<LogOut size={16} />
						<span>Sign out</span>
					</button>
				</header>

				<main className="content-frame">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
