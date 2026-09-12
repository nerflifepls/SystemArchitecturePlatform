import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	Boxes,
	ChevronRight,
	LayoutDashboard,
	LogOut,
	Plus,
	Sparkles,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { authApi, workspaceApi } from "../api/endpoints";
import { sessionQueryKey, useSession } from "../hooks/useAuth";
import styles from "./AppShell.module.css";

function getCurrentSection(pathname: string) {
	if (pathname.includes("/diagrams/")) {
		return "Diagram details";
	}

	if (pathname.includes("/projects/")) {
		return "Project overview";
	}

	if (pathname.startsWith("/workspaces/")) {
		return "Workspace overview";
	}

	return "Dashboard";
}

export function AppShell() {
	const sessionQuery = useSession();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
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
	const user = sessionQuery.data?.user;
	const userLabel = user?.name ?? user?.email ?? "Account";
	const userInitial = userLabel.trim().charAt(0).toUpperCase() || "U";
	const currentSection = getCurrentSection(location.pathname);

	return (
		<div className={styles.shell}>
			<aside className={styles.sidebar} aria-label="Primary navigation">
				<Link className={styles.brand} to="/" aria-label="System Design dashboard">
					<span className={styles.brandMark} aria-hidden="true">
						<Boxes size={19} />
					</span>
					<span className={styles.brandCopy}>
						<strong>System Design</strong>
						<span>Architecture workspace</span>
					</span>
				</Link>

				<nav className={styles.navigation}>
					<p className={styles.navLabel}>Overview</p>
					<NavLink
						to="/"
						end
						className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ""}`}
					>
						<span className={styles.navIcon}><LayoutDashboard size={17} /></span>
						<span>Dashboard</span>
					</NavLink>

					<div className={styles.workspaceHeading}>
						<p className={styles.navLabel}>Workspaces</p>
						<span className={styles.countBadge}>{workspacesQuery.data?.length ?? 0}</span>
						<Link className={styles.addWorkspace} to="/#new-workspace" aria-label="Create workspace">
							<Plus size={14} />
						</Link>
					</div>

					<div className={styles.workspaceLinks}>
						{workspacesQuery.isPending ?
							<>
								<span className={styles.navSkeleton} />
								<span className={styles.navSkeleton} />
							</>
						: null}
						{workspacesQuery.isError ?
							<p className={styles.navMessage}>Workspaces unavailable</p>
						: null}
						{!workspacesQuery.isPending && workspacesQuery.data?.length === 0 ?
							<p className={styles.navMessage}>Your workspaces will appear here.</p>
						: null}
						{workspacesQuery.data?.map((workspace) => (
							<NavLink
								key={workspace.id}
								to={`/workspaces/${workspace.id}`}
								className={({ isActive }) =>
									`${styles.workspaceLink} ${isActive ? styles.active : ""}`
								}
							>
								<span className={styles.workspaceMonogram} aria-hidden="true">
									{workspace.name.trim().charAt(0).toUpperCase() || "W"}
								</span>
								<span className={styles.workspaceName}>{workspace.name}</span>
								<ChevronRight size={14} className={styles.workspaceChevron} />
							</NavLink>
						))}
					</div>
				</nav>

				<div className={styles.sidebarFooter}>
					<div className={styles.syncStatus}>
						<span className={styles.statusDot} aria-hidden="true" />
						<span>Workspace synced</span>
						<Activity size={13} />
					</div>
					<div className={styles.userCard}>
						{user?.avatarUrl ?
							<img className={styles.userAvatar} src={user.avatarUrl} alt="" />
						: <span className={styles.userAvatar} aria-hidden="true">{userInitial}</span>}
						<span className={styles.userCopy}>
							<strong>{userLabel}</strong>
							<span>{user?.email ?? "Signed in"}</span>
						</span>
						<button
							className={styles.signOutButton}
							type="button"
							onClick={() => signOutMutation.mutate()}
							disabled={signOutMutation.isPending}
							aria-label="Sign out"
						>
							<LogOut size={16} />
						</button>
					</div>
				</div>
			</aside>

			<div className={styles.mainShell}>
				<header className={styles.topbar}>
					<div className={styles.contextTrail}>
						<span>System Design</span>
						<ChevronRight size={14} aria-hidden="true" />
						<strong>{currentSection}</strong>
					</div>
					<div className={styles.topbarActions}>
						<Link className={styles.createLink} to="/#new-workspace" aria-label="New workspace">
							<Sparkles size={15} />
							<span>New workspace</span>
						</Link>
						<div className={styles.topbarAccount}>
							<span className={styles.compactAvatar} aria-hidden="true">{userInitial}</span>
							<span>{userLabel}</span>
						</div>
					</div>
				</header>

				<main className={styles.content}>
					<Outlet />
				</main>
			</div>
		</div>
	);
}
