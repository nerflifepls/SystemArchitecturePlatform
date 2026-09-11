import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, UserPlus, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";

import { projectApi, workspaceApi } from "../api/endpoints";
import type { WorkspaceRole } from "../api/types";
import { ProjectCard } from "../components/projects/ProjectCard";
import {
	Button,
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
import {
	canEditWorkspaceContent,
	canManageWorkspaceMembers,
	inviteRoleOptions,
	type InviteRole,
} from "../utils/roles";

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

	return (
		<div className="page-stack">
			<PageHeader
				eyebrow="Workspace"
				title={workspaceQuery.data?.name ?? "Workspace"}
				actions={
					<>
						<span className="meta-pill">{projectsQuery.data?.length ?? 0} projects</span>
						<span className="meta-pill">{membersQuery.data?.length ?? 0} members</span>
					</>
				}
			/>

			{workspaceQuery.isError ?
				<ErrorPanel>{getErrorMessage(workspaceQuery.error)}</ErrorPanel>
			:	null}

			{canManageMembers ? <ToolPanel aria-labelledby="workspace-settings-title">
				<div>
					<h2 id="workspace-settings-title">Workspace details</h2>
					<p className="muted-copy">Update the workspace name shown to collaborators.</p>
				</div>
				<InlineForm onSubmit={handleUpdateWorkspace}>
					<FormField label="Name">
						<input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
					</FormField>
					<Button
						variant="primary"
						type="submit"
						disabled={!workspaceName.trim() || updateWorkspace.isPending}
					>
						<Save size={16} />
						<span>Save</span>
					</Button>
				</InlineForm>
				{updateWorkspace.isError ?
					<FormError>{getErrorMessage(updateWorkspace.error)}</FormError>
				:	null}
			</ToolPanel> : null}

			<ToolPanel className="members-panel" aria-labelledby="workspace-members-title">
				<div>
					<span className="section-icon" aria-hidden="true">
						<Users size={17} />
					</span>
					<h2 id="workspace-members-title">Members</h2>
					<p className="muted-copy">Invite collaborators and adjust workspace access.</p>
				</div>

				<div className="members-workspace">
					{canManageMembers ?
						<InlineForm className="member-invite-form" onSubmit={handleInviteMember}>
							<FormField label="Email">
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
								<span>Invite</span>
							</Button>
						</InlineForm>
					:	<p className="muted-copy">Owners and admins manage invitations for this workspace.</p>}

					{inviteMember.isError ?
						<FormError>{getErrorMessage(inviteMember.error)}</FormError>
					:	null}
					{updateMemberRole.isError ?
						<FormError>{getErrorMessage(updateMemberRole.error)}</FormError>
					:	null}
					{removeMember.isError ?
						<FormError>{getErrorMessage(removeMember.error)}</FormError>
					:	null}

					<div className="member-list" aria-label="Workspace members">
						{membersQuery.isPending ?
							<StatusPanel>Loading members...</StatusPanel>
						:	null}
						{membersQuery.isError ?
							<ErrorPanel>{getErrorMessage(membersQuery.error)}</ErrorPanel>
						:	null}
						{membersQuery.data?.length === 0 ?
							<StatusPanel>No members yet.</StatusPanel>
						:	null}
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

			{canEditContent ? <ToolPanel aria-labelledby="new-project-title">
				<div>
					<h2 id="new-project-title">New project</h2>
					<p className="muted-copy">Projects group diagrams for one design effort.</p>
				</div>
				<InlineForm onSubmit={handleCreateProject}>
					<FormField label="Name">
						<input
							value={projectName}
							onChange={(event) => setProjectName(event.target.value)}
							placeholder="Checkout platform"
						/>
					</FormField>
					<FormField label="Description">
						<input
							value={projectDescription}
							onChange={(event) => setProjectDescription(event.target.value)}
						/>
					</FormField>
					<Button variant="primary" type="submit" disabled={!projectName.trim() || createProject.isPending}>
						<Plus size={16} />
						<span>Create</span>
					</Button>
				</InlineForm>
				{createProject.isError ?
					<FormError>{getErrorMessage(createProject.error)}</FormError>
				:	null}
			</ToolPanel> : null}

			{projectsQuery.isError ?
				<ErrorPanel>{getErrorMessage(projectsQuery.error)}</ErrorPanel>
			:	null}

			<ResourceGrid
				aria-label="Project list"
				isLoading={projectsQuery.isPending}
				loadingMessage="Loading projects..."
				isEmpty={projectsQuery.data?.length === 0}
				emptyMessage="No projects yet."
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
		</div>
	);
}
