import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	FolderKanban,
	Plus,
	Save,
	Settings2,
	ShieldCheck,
	UserPlus,
	Users,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";

import { projectApi, workspaceApi } from "../api/endpoints";
import type { WorkspaceRole } from "../api/types";
import { ProjectCard } from "../components/projects/ProjectCard";
import {
	Button,
	ButtonLink,
	ErrorPanel,
	FormError,
	FormField,
	InlineForm,
	PageHeader,
	ResourceGrid,
	StatusPanel,
	ToolPanel,
} from "../components/ui";
import { MemberRow } from "../components/workspaces/MemberRow";
import { getErrorMessage } from "../utils/errors";
import { formatUpdatedAt } from "../utils/format";
import {
	canEditWorkspaceContent,
	canManageWorkspaceMembers,
	inviteRoleOptions,
	roleLabels,
	type InviteRole,
} from "../utils/roles";
import styles from "./WorkspacePage.module.css";

export function WorkspacePage() {
	const { workspaceId = "" } = useParams();
	const queryClient = useQueryClient();
	const [workspaceName, setWorkspaceName] = useState("");
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<InviteRole>("editor");
	const [projectName, setProjectName] = useState("");
	const [projectDescription, setProjectDescription] = useState("");

	const workspaceQuery = useQuery({
		queryKey: ["workspace", workspaceId],
		queryFn: ({ signal }) => workspaceApi.get(workspaceId, signal),
		enabled: Boolean(workspaceId),
	});

	const projectsQuery = useQuery({
		queryKey: ["projects", workspaceId],
		queryFn: ({ signal }) => projectApi.list(workspaceId, signal),
		enabled: Boolean(workspaceId),
	});

	const membersQuery = useQuery({
		queryKey: ["workspace-members", workspaceId],
		queryFn: ({ signal }) => workspaceApi.listMembers(workspaceId, signal),
		enabled: Boolean(workspaceId),
	});

	useEffect(() => {
		if (workspaceQuery.data) {
			setWorkspaceName(workspaceQuery.data.name);
		}
	}, [workspaceQuery.data]);

	const updateWorkspace = useMutation({
		mutationFn: () => workspaceApi.update(workspaceId, { name: workspaceName.trim() }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
			void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
		},
	});

	const inviteMember = useMutation({
		mutationFn: () => workspaceApi.addMember(workspaceId, { email: inviteEmail.trim(), role: inviteRole }),
		onSuccess: () => {
			setInviteEmail("");
			setInviteRole("editor");
			invalidateWorkspaceAccess();
		},
	});

	const updateMemberRole = useMutation({
		mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
			workspaceApi.updateMember(workspaceId, userId, { role }),
		onSuccess: () => {
			invalidateWorkspaceAccess();
		},
	});

	const removeMember = useMutation({
		mutationFn: (userId: string) => workspaceApi.removeMember(workspaceId, userId),
		onSuccess: () => {
			invalidateWorkspaceAccess();
		},
	});

	const createProject = useMutation({
		mutationFn: () =>
			projectApi.create({
				workspaceId,
				name: projectName.trim(),
				description: projectDescription.trim() || undefined,
			}),
		onSuccess: () => {
			setProjectName("");
			setProjectDescription("");
			void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
		},
	});

	function handleUpdateWorkspace(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (workspaceName.trim()) {
			updateWorkspace.mutate();
		}
	}

	function handleInviteMember(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (inviteEmail.trim()) {
			inviteMember.mutate();
		}
	}

	function handleCreateProject(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (projectName.trim()) {
			createProject.mutate();
		}
	}

	function invalidateWorkspaceAccess() {
		void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
		void queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
		void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
	}

	const canManageMembers = canManageWorkspaceMembers(workspaceQuery.data?.role);
	const canEditContent = canEditWorkspaceContent(workspaceQuery.data?.role);
	const ownerCount = membersQuery.data?.filter((member) => member.role === "owner").length ?? 0;
	const roleLabel = workspaceQuery.data?.role ? roleLabels[workspaceQuery.data.role] : "Member";

	return (
		<div className={styles.page}>
			<PageHeader
				eyebrow="Workspace overview"
				title={workspaceQuery.data?.name ?? "Workspace"}
				description="A shared home for the projects, people, and architecture decisions behind your system."
				actions={
					<>
						<ButtonLink to="/">
							<ArrowLeft size={16} />
							<span>Dashboard</span>
						</ButtonLink>
						<span className={styles.rolePill}><ShieldCheck size={14} /> {roleLabel}</span>
					</>
				}
			/>

			{workspaceQuery.isError ?
				<ErrorPanel>{getErrorMessage(workspaceQuery.error)}</ErrorPanel>
			: null}

			<section className={styles.summary} aria-label="Workspace summary">
				<article>
					<span className={styles.summaryIcon}><FolderKanban size={18} /></span>
					<div><strong>{projectsQuery.data?.length ?? 0}</strong><span>Projects</span></div>
				</article>
				<article>
					<span className={styles.summaryIcon}><Users size={18} /></span>
					<div><strong>{membersQuery.data?.length ?? 0}</strong><span>Collaborators</span></div>
				</article>
				<article>
					<span className={styles.summaryIcon}><ShieldCheck size={18} /></span>
					<div><strong>{roleLabel}</strong><span>Your access</span></div>
				</article>
				<article>
					<span className={styles.activityDot} aria-hidden="true" />
					<div><strong>Active</strong><span>{formatUpdatedAt(workspaceQuery.data?.updatedAt)}</span></div>
				</article>
			</section>

			<div className={styles.workspaceLayout}>
				<section className={styles.projectsSection} aria-labelledby="projects-title">
					<header className={styles.sectionHeading}>
						<div>
							<span className="eyebrow">Architecture library</span>
							<h2 id="projects-title">Projects</h2>
							<p>Each project keeps a design effort focused and easy to find.</p>
						</div>
						{canEditContent ?
							<a className={styles.textAction} href="#new-project">
								<Plus size={15} />
								New project
							</a>
						: null}
					</header>

					{projectsQuery.isError ?
						<ErrorPanel>{getErrorMessage(projectsQuery.error)}</ErrorPanel>
					: null}

					<ResourceGrid
						className={styles.projectGrid}
						aria-label="Project list"
						isLoading={projectsQuery.isPending}
						loadingMessage="Loading projects..."
						isEmpty={projectsQuery.data?.length === 0}
						emptyMessage="No projects yet. Create one to start mapping the system."
					>
						{projectsQuery.data?.map((project) => (
							<ProjectCard
								key={project.id}
								project={project}
								workspaceId={workspaceId}
								role={workspaceQuery.data?.role}
							/>
						))}
					</ResourceGrid>
				</section>

				<aside className={styles.sideColumn} aria-label="Workspace tools">
					{canEditContent ?
						<ToolPanel id="new-project" className={styles.sidePanel} aria-labelledby="new-project-title">
							<div className={styles.panelHeading}>
								<span className={styles.panelIcon}><Plus size={17} /></span>
								<div>
									<span className="eyebrow">Create</span>
									<h2 id="new-project-title">New project</h2>
									<p>Start a focused architecture effort.</p>
								</div>
							</div>
							<form className={styles.stackForm} onSubmit={handleCreateProject}>
								<FormField label="Project name">
									<input
										value={projectName}
										onChange={(event) => setProjectName(event.target.value)}
										placeholder="e.g. Checkout platform"
									/>
								</FormField>
								<FormField label="Description">
									<textarea
										value={projectDescription}
										onChange={(event) => setProjectDescription(event.target.value)}
										placeholder="What is this system responsible for?"
									/>
								</FormField>
								<Button variant="primary" type="submit" disabled={!projectName.trim() || createProject.isPending}>
									<Plus size={16} />
									<span>{createProject.isPending ? "Creating..." : "Create project"}</span>
								</Button>
							</form>
							{createProject.isError ?
								<FormError>{getErrorMessage(createProject.error)}</FormError>
							: null}
						</ToolPanel>
					: null}

					{canManageMembers ?
						<ToolPanel className={styles.sidePanel} aria-labelledby="workspace-settings-title">
							<div className={styles.panelHeading}>
								<span className={styles.panelIcon}><Settings2 size={17} /></span>
								<div>
									<span className="eyebrow">Settings</span>
									<h2 id="workspace-settings-title">Workspace details</h2>
									<p>Keep the workspace easy to recognize.</p>
								</div>
							</div>
							<form className={styles.stackForm} onSubmit={handleUpdateWorkspace}>
								<FormField label="Workspace name">
									<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
								</FormField>
								<Button
									variant="secondary"
									type="submit"
									disabled={!workspaceName.trim() || updateWorkspace.isPending}
								>
									<Save size={16} />
									<span>{updateWorkspace.isPending ? "Saving..." : "Save changes"}</span>
								</Button>
							</form>
							{updateWorkspace.isError ?
								<FormError>{getErrorMessage(updateWorkspace.error)}</FormError>
							: null}
						</ToolPanel>
					: null}
				</aside>
			</div>

			<ToolPanel className={styles.membersPanel} aria-labelledby="workspace-members-title">
				<div className={styles.membersIntro}>
					<span className={styles.panelIcon}><Users size={18} /></span>
					<span className="eyebrow">Collaboration</span>
					<h2 id="workspace-members-title">Workspace members</h2>
					<p>Invite the right people and keep access levels clear.</p>
					<span className={styles.memberCount}>{membersQuery.data?.length ?? 0} people</span>
				</div>

				<div className={styles.membersWorkspace}>
					{canManageMembers ?
						<InlineForm className={styles.inviteForm} onSubmit={handleInviteMember}>
							<FormField label="Email address">
								<input
									type="email"
									value={inviteEmail}
									onChange={(event) => setInviteEmail(event.target.value)}
									placeholder="teammate@example.com"
								/>
							</FormField>
							<FormField label="Role">
								<select
									value={inviteRole}
									onChange={(event) => setInviteRole(event.target.value as InviteRole)}
								>
									{inviteRoleOptions.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</FormField>
							<Button
								variant="primary"
								type="submit"
								disabled={!inviteEmail.trim() || inviteMember.isPending}
							>
								<UserPlus size={16} />
								<span>{inviteMember.isPending ? "Inviting..." : "Invite member"}</span>
							</Button>
						</InlineForm>
					: <p className={styles.readOnlyMessage}>Owners and admins manage invitations for this workspace.</p>}

					{inviteMember.isError ? <FormError>{getErrorMessage(inviteMember.error)}</FormError> : null}
					{updateMemberRole.isError ? <FormError>{getErrorMessage(updateMemberRole.error)}</FormError> : null}
					{removeMember.isError ? <FormError>{getErrorMessage(removeMember.error)}</FormError> : null}

					<div className={styles.memberList} aria-label="Workspace members">
						{membersQuery.isPending ? <StatusPanel>Loading members...</StatusPanel> : null}
						{membersQuery.isError ? <ErrorPanel>{getErrorMessage(membersQuery.error)}</ErrorPanel> : null}
						{membersQuery.data?.length === 0 ? <StatusPanel>No members yet.</StatusPanel> : null}
						{membersQuery.data?.map((member) => (
							<MemberRow
								key={member.user.id}
								member={member}
								canManageMembers={canManageMembers}
								cannotChangeLastOwner={member.role === "owner" && ownerCount <= 1}
								isUpdatingRole={updateMemberRole.isPending}
								isRemovingMember={removeMember.isPending}
								onChangeRole={(userId, role) => updateMemberRole.mutate({ userId, role })}
								onRemove={(userId) => removeMember.mutate(userId)}
							/>
						))}
					</div>
				</div>
			</ToolPanel>
		</div>
	);
}
