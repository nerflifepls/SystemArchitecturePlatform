import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowUpRight,
	Boxes,
	Database,
	FolderKanban,
	Monitor,
	Plus,
	Search,
	ShieldCheck,
	Trash2,
	UsersRound,
	Waypoints,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { workspaceApi } from "../api/endpoints";
import {
	Button,
	ButtonLink,
	ErrorPanel,
	FormError,
	FormField,
	ResourceCard,
	ResourceCardBody,
	ResourceGrid,
	ToolPanel,
} from "../components/ui";
import { useSession } from "../hooks/useAuth";
import { getErrorMessage } from "../utils/errors";
import { formatUpdatedAt } from "../utils/format";
import { canDeleteWorkspace, roleLabels } from "../utils/roles";
import styles from "./DashboardPage.module.css";

export function DashboardPage() {
	const queryClient = useQueryClient();
	const sessionQuery = useSession();
	const [name, setName] = useState("");
	const [search, setSearch] = useState("");
	const workspacesQuery = useQuery({
		queryKey: ["workspaces"],
		queryFn: ({ signal }) => workspaceApi.list(signal),
	});

	const createWorkspace = useMutation({
		mutationFn: () => workspaceApi.create({ name: name.trim() }),
		onSuccess: () => {
			setName("");
			void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
		},
	});

	const deleteWorkspace = useMutation({
		mutationFn: (workspaceId: string) => workspaceApi.remove(workspaceId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
		},
	});

	function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (name.trim()) {
			createWorkspace.mutate();
		}
	}

	const workspaces = workspacesQuery.data ?? [];
	const filteredWorkspaces = useMemo(() => {
		const normalizedSearch = search.trim().toLowerCase();
		return normalizedSearch ?
			workspaces.filter((workspace) => workspace.name.toLowerCase().includes(normalizedSearch))
		: workspaces;
	}, [search, workspaces]);
	const ownerCount = workspaces.filter((workspace) => workspace.role === "owner").length;
	const sharedCount = workspaces.filter((workspace) => workspace.role && workspace.role !== "owner").length;
	const displayName = sessionQuery.data?.user?.name?.trim().split(/\s+/)[0] || "there";

	return (
		<div className={styles.page}>
			<div className={styles.dashboardGrid}>
				<section className={styles.welcomePanel} aria-labelledby="dashboard-title">
					<div className={styles.welcomeCopy}>
						<span className={styles.livePill}><span /> Your design command center</span>
						<h1 id="dashboard-title">Welcome back, {displayName}.</h1>
						<p>Move from idea to shared architecture with every workspace, project, and diagram in reach.</p>
						<a className={styles.heroAction} href="#workspaces">
							Explore workspaces
							<ArrowUpRight size={16} />
						</a>
					</div>

					<div className={styles.architectureMap} aria-hidden="true">
						<div className={[styles.mapNode, styles.nodeClient].join(" ")}>
							<Monitor size={16} />
							<span>Client</span>
						</div>
						<div className={[styles.mapNode, styles.nodeGateway].join(" ")}>
							<Waypoints size={16} />
							<span>Gateway</span>
						</div>
						<div className={[styles.mapNode, styles.nodeData].join(" ")}>
							<Database size={16} />
							<span>Data</span>
						</div>
						<span className={[styles.mapEdge, styles.edgeOne].join(" ")} />
						<span className={[styles.mapEdge, styles.edgeTwo].join(" ")} />
						<span className={styles.mapPulse} />
					</div>
				</section>

				<ToolPanel id="new-workspace" className={styles.createPanel} aria-labelledby="new-workspace-title">
					<div className={styles.panelHeading}>
						<span className={styles.panelIcon}><Plus size={17} /></span>
						<div>
							<span className="eyebrow">Quick start</span>
							<h2 id="new-workspace-title">Create a workspace</h2>
							<p>Give a new system its own home.</p>
						</div>
					</div>
					<form className={styles.createForm} onSubmit={handleCreateWorkspace}>
						<FormField label="Workspace name">
							<input
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="e.g. Commerce platform"
							/>
						</FormField>
						<Button variant="primary" type="submit" disabled={!name.trim() || createWorkspace.isPending}>
							<Plus size={16} />
							<span>{createWorkspace.isPending ? "Creating..." : "Create workspace"}</span>
						</Button>
					</form>
					{createWorkspace.isError ?
						<FormError>{getErrorMessage(createWorkspace.error)}</FormError>
					: null}
				</ToolPanel>
			</div>

			<section className={styles.stats} aria-label="Workspace summary">
				<article className={styles.stat}>
					<span className={styles.statIcon}><Boxes size={17} /></span>
					<div><strong>{workspaces.length}</strong><span>Total workspaces</span></div>
				</article>
				<article className={styles.stat}>
					<span className={styles.statIcon}><ShieldCheck size={17} /></span>
					<div><strong>{ownerCount}</strong><span>Owned by you</span></div>
				</article>
				<article className={styles.stat}>
					<span className={styles.statIcon}><UsersRound size={17} /></span>
					<div><strong>{sharedCount}</strong><span>Shared with you</span></div>
				</article>
			</section>

			<section id="workspaces" className={styles.workspaceSection} aria-labelledby="workspace-list-title">
				<header className={styles.sectionHeading}>
					<div>
						<span className="eyebrow">Your library</span>
						<h2 id="workspace-list-title">Workspaces</h2>
						<p>Pick up where your team left off.</p>
					</div>
					<div className={styles.searchBox}>
						<Search size={16} aria-hidden="true" />
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search workspaces"
							aria-label="Search workspaces"
						/>
					</div>
				</header>

				{workspacesQuery.isError ?
					<ErrorPanel>{getErrorMessage(workspacesQuery.error)}</ErrorPanel>
				: null}

				<ResourceGrid
					className={styles.workspaceGrid}
					aria-label="Workspace list"
					isLoading={workspacesQuery.isPending}
					loadingMessage="Loading workspaces..."
					isEmpty={!workspacesQuery.isPending && filteredWorkspaces.length === 0}
					emptyMessage={search.trim() ? "No workspaces match your search." : "No workspaces yet. Create your first one above."}
				>
					{filteredWorkspaces.map((workspace) => (
						<ResourceCard
							key={workspace.id}
							className={styles.workspaceCard}
							icon={<FolderKanban size={19} />}
							actions={
								<>
									<ButtonLink variant="primary" size="compact" to={"/workspaces/" + workspace.id}>
										<span>Open workspace</span>
										<ArrowUpRight size={15} />
									</ButtonLink>
									{canDeleteWorkspace(workspace.role) ?
										<Button
											variant="icon"
											size="compact"
											tone="danger"
											type="button"
											onClick={() => deleteWorkspace.mutate(workspace.id)}
											aria-label={"Delete " + workspace.name}
										>
											<Trash2 size={16} />
										</Button>
									: null}
								</>
							}
						>
							<ResourceCardBody>
								<div className={styles.cardMeta}>
									<span><ShieldCheck size={13} /> {workspace.role ? roleLabels[workspace.role] : "Member"}</span>
									<span>{formatUpdatedAt(workspace.updatedAt)}</span>
								</div>
								<h2>{workspace.name}</h2>
								<p>A shared home for architecture projects, diagrams, and collaborators.</p>
								<span className={styles.readyState}><span /> Ready for your next design</span>
							</ResourceCardBody>
						</ResourceCard>
					))}
				</ResourceGrid>
				{deleteWorkspace.isError ?
					<FormError>{getErrorMessage(deleteWorkspace.error)}</FormError>
				: null}
			</section>
		</div>
	);
}
