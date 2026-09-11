import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CircleUserRound, LayoutDashboard, LogOut, Plus } from "lucide-react";
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
	const userLabel = sessionQuery.data?.user?.name ?? sessionQuery.data?.user?.email ?? "Account";
	const userInitial = userLabel.trim().charAt(0).toUpperCase() || "U";

	return (
		<div className="app-shell">
			<aside className="sidebar" aria-label="Primary">
				<div className="brand-block sidebar-brand">
					<span className="brand-mark" aria-hidden="true"><Boxes size={19} /></span>
					<div>
						<strong>System Design</strong>
						<span>Visual architecture</span>
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
					<div className="sidebar-user">
						<span className="user-avatar" aria-hidden="true">{userInitial}</span>
						<div>
							<strong>{userLabel}</strong>
							<span>Active account</span>
						</div>
					</div>
					<span className="api-pill">API · {API_BASE_URL}</span>
				</div>
			</aside>

			<div className="workspace-shell">
				<header className="topbar">
					<div>
						<span className="eyebrow">Design workspace</span>
						<strong><CircleUserRound size={16} /> {userLabel}</strong>
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
