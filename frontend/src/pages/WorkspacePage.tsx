import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, FolderKanban, Plus, Save, Trash2, UserPlus, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { projectApi, workspaceApi } from "../api/endpoints";
import type { ProjectDto, WorkspaceRole } from "../api/types";
import { getErrorMessage } from "../utils/errors";

type InviteRole = Exclude<WorkspaceRole, "owner">;

const roleLabels: Record<WorkspaceRole, string> = {
	owner: "Owner",
	admin: "Admin",
	editor: "Editor",
	viewer: "Viewer",
};

const inviteRoleOptions: Array<{ value: InviteRole; label: string }> = [
	{ value: "admin", label: roleLabels.admin },
	{ value: "editor", label: roleLabels.editor },
	{ value: "viewer", label: roleLabels.viewer },
];

const memberRoleOptions: Array<{ value: WorkspaceRole; label: string }> = [
	{ value: "owner", label: roleLabels.owner },
	{ value: "admin", label: roleLabels.admin },
	{ value: "editor", label: roleLabels.editor },
	{ value: "viewer", label: roleLabels.viewer },
];

function getMemberInitials(name: string, email: string) {
	const base = name.trim() || email.trim();
	return (
		base
			.split(/\s+|@/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join("") || "?"
	);
}

type ProjectCardProps = {
	project: ProjectDto;
	workspaceId: string;
};

function ProjectCard({ project, workspaceId }: ProjectCardProps) {
	const queryClient = useQueryClient();
	const [isEditing, setIsEditing] = useState(false);
	const [name, setName] = useState(project.name);
	const [description, setDescription] = useState(project.description ?? "");

	const updateProject = useMutation({
		mutationFn: () =>
			projectApi.update(project.id, { name: name.trim(), description: description.trim() || undefined }),
		onSuccess: () => {
			setIsEditing(false);
			void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
			void queryClient.invalidateQueries({ queryKey: ["project", project.id] });
		},
	});

	const deleteProject = useMutation({
		mutationFn: () => projectApi.remove(project.id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
		},
	});

	function handleUpdateProject(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (name.trim()) {
			updateProject.mutate();
		}
	}

	return (
		<article className="resource-card">
			<div className="card-icon">
				<FolderKanban size={18} />
			</div>
			{isEditing ?
				<form className="resource-card-body edit-form" onSubmit={handleUpdateProject}>
					<label>
						<span>Name</span>
						<input value={name} onChange={(event) => setName(event.target.value)} />
					</label>
					<label>
						<span>Description</span>
						<input value={description} onChange={(event) => setDescription(event.target.value)} />
					</label>
					<div className="row-actions">
						<button
							className="primary-button"
							type="submit"
							disabled={!name.trim() || updateProject.isPending}
						>
							<Save size={15} />
							<span>Save</span>
						</button>
						<button className="secondary-button" type="button" onClick={() => setIsEditing(false)}>
							Cancel
						</button>
					</div>
				</form>
			:	<div className="resource-card-body">
					<h2>{project.name}</h2>
					<p>{project.description || "No description"}</p>
				</div>
			}
			<div className="card-actions">
				<Link className="secondary-button" to={`/workspaces/${workspaceId}/projects/${project.id}`}>
					Open
				</Link>
				<button
					className="icon-button"
					type="button"
					onClick={() => setIsEditing((value) => !value)}
					aria-label="Edit project"
				>
					<Edit3 size={16} />
				</button>
				<button
					className="icon-button danger"
					type="button"
					onClick={() => deleteProject.mutate()}
					aria-label="Delete project"
				>
					<Trash2 size={16} />
				</button>
			</div>
			{updateProject.isError ?
				<p className="form-error card-message">{getErrorMessage(updateProject.error)}</p>
			:	null}
			{deleteProject.isError ?
				<p className="form-error card-message">{getErrorMessage(deleteProject.error)}</p>
			:	null}
		</article>
	);
}

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

	const canManageMembers = workspaceQuery.data?.role === "owner" || workspaceQuery.data?.role === "admin";
	const ownerCount = membersQuery.data?.filter((member) => member.role === "owner").length ?? 0;

	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<span className="eyebrow">Workspace</span>
					<h1>{workspaceQuery.data?.name ?? "Workspace"}</h1>
				</div>
				<div className="page-actions">
					<span className="meta-pill">{projectsQuery.data?.length ?? 0} projects</span>
					<span className="meta-pill">{membersQuery.data?.length ?? 0} members</span>
				</div>
			</div>

			{workspaceQuery.isError ?
				<div className="error-panel">{getErrorMessage(workspaceQuery.error)}</div>
			:	null}

			<section className="tool-panel" aria-labelledby="workspace-settings-title">
				<div>
					<h2 id="workspace-settings-title">Workspace details</h2>
					<p className="muted-copy">Update the workspace name shown to collaborators.</p>
				</div>
				<form className="inline-form" onSubmit={handleUpdateWorkspace}>
					<label>
						<span>Name</span>
						<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
					</label>
					<button
						className="primary-button"
						type="submit"
						disabled={!workspaceName.trim() || updateWorkspace.isPending}
					>
						<Save size={16} />
						<span>Save</span>
					</button>
				</form>
				{updateWorkspace.isError ?
					<p className="form-error">{getErrorMessage(updateWorkspace.error)}</p>
				:	null}
			</section>

			<section className="tool-panel members-panel" aria-labelledby="workspace-members-title">
				<div>
					<span className="section-icon" aria-hidden="true">
						<Users size={17} />
					</span>
					<h2 id="workspace-members-title">Members</h2>
					<p className="muted-copy">Invite collaborators and adjust workspace access.</p>
				</div>

				<div className="members-workspace">
					{canManageMembers ?
						<form className="member-invite-form" onSubmit={handleInviteMember}>
							<label>
								<span>Email</span>
								<input
									type="email"
									value={inviteEmail}
									onChange={(event) => setInviteEmail(event.target.value)}
									placeholder="teammate@example.com"
								/>
							</label>
							<label>
								<span>Role</span>
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
							</label>
							<button
								className="primary-button"
								type="submit"
								disabled={!inviteEmail.trim() || inviteMember.isPending}
							>
								<UserPlus size={16} />
								<span>Invite</span>
							</button>
						</form>
					:	<p className="muted-copy">Owners and admins manage invitations for this workspace.</p>}

					{inviteMember.isError ?
						<p className="form-error">{getErrorMessage(inviteMember.error)}</p>
					:	null}
					{updateMemberRole.isError ?
						<p className="form-error">{getErrorMessage(updateMemberRole.error)}</p>
					:	null}
					{removeMember.isError ?
						<p className="form-error">{getErrorMessage(removeMember.error)}</p>
					:	null}

					<div className="member-list" aria-label="Workspace members">
						{membersQuery.isPending ?
							<div className="status-panel">Loading members...</div>
						:	null}
						{membersQuery.isError ?
							<div className="error-panel">{getErrorMessage(membersQuery.error)}</div>
						:	null}
						{membersQuery.data?.length === 0 ?
							<div className="status-panel">No members yet.</div>
						:	null}
						{membersQuery.data?.map((member) => {
							const cannotChangeLastOwner = member.role === "owner" && ownerCount <= 1;

							return (
								<article className="member-row" key={member.user.id}>
									<div className="member-identity">
										{member.user.avatarUrl ?
											<img className="member-avatar" src={member.user.avatarUrl} alt="" />
										:	<span className="member-avatar initials" aria-hidden="true">
												{getMemberInitials(member.user.name, member.user.email)}
											</span>
										}
										<div className="member-copy">
											<strong>{member.user.name || member.user.email}</strong>
											<span>{member.user.email}</span>
										</div>
									</div>

									{canManageMembers ?
										<div className="member-controls">
											<select
												value={member.role}
												disabled={updateMemberRole.isPending || cannotChangeLastOwner}
												onChange={(event) =>
													updateMemberRole.mutate({
														userId: member.user.id,
														role: event.target.value as WorkspaceRole,
													})
												}
											>
												{memberRoleOptions.map((option) => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
											<button
												className="icon-button danger"
												type="button"
												onClick={() => removeMember.mutate(member.user.id)}
												disabled={removeMember.isPending || cannotChangeLastOwner}
												aria-label={`Remove ${member.user.name || member.user.email}`}
											>
												<Trash2 size={16} />
											</button>
										</div>
									:	<span className="member-role-badge">{roleLabels[member.role]}</span>}
								</article>
							);
						})}
					</div>
				</div>
			</section>

			<section className="tool-panel" aria-labelledby="new-project-title">
				<div>
					<h2 id="new-project-title">New project</h2>
					<p className="muted-copy">Projects group diagrams for one design effort.</p>
				</div>
				<form className="inline-form" onSubmit={handleCreateProject}>
					<label>
						<span>Name</span>
						<input
							value={projectName}
							onChange={(event) => setProjectName(event.target.value)}
							placeholder="Checkout platform"
						/>
					</label>
					<label>
						<span>Description</span>
						<input
							value={projectDescription}
							onChange={(event) => setProjectDescription(event.target.value)}
						/>
					</label>
					<button
						className="primary-button"
						type="submit"
						disabled={!projectName.trim() || createProject.isPending}
					>
						<Plus size={16} />
						<span>Create</span>
					</button>
				</form>
				{createProject.isError ?
					<p className="form-error">{getErrorMessage(createProject.error)}</p>
				:	null}
			</section>

			{projectsQuery.isError ?
				<div className="error-panel">{getErrorMessage(projectsQuery.error)}</div>
			:	null}

			<section className="resource-grid" aria-label="Project list">
				{projectsQuery.isPending ?
					<div className="status-panel">Loading projects...</div>
				:	null}
				{projectsQuery.data?.length === 0 ?
					<div className="status-panel">No projects yet.</div>
				:	null}
				{projectsQuery.data?.map((project) => (
					<ProjectCard key={project.id} project={project} workspaceId={workspaceId} />
				))}
			</section>
		</div>
	);
}
