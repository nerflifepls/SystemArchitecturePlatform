import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { workspaceApi } from "../api/endpoints";
import {
	Button,
	ButtonLink,
	ErrorPanel,
	FormError,
	FormField,
	InlineForm,
	PageHeader,
	ResourceCard,
	ResourceCardBody,
	ResourceGrid,
	ToolPanel,
} from "../components/ui";
import { getErrorMessage } from "../utils/errors";
import { canDeleteWorkspace } from "../utils/roles";

export function DashboardPage() {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
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

	return (
		<div className="page-stack">
			<PageHeader
				eyebrow="Dashboard"
				title="Workspaces"
				description="Organize your systems, projects, and collaborators in one place."
				actions={<span className="meta-pill">{workspacesQuery.data?.length ?? 0} workspaces</span>}
			/>

			<ToolPanel aria-labelledby="new-workspace-title">
				<div>
					<h2 id="new-workspace-title">New workspace</h2>
					<p className="muted-copy">Create a bounded area for projects, diagrams, and collaborators.</p>
				</div>
				<InlineForm onSubmit={handleCreateWorkspace}>
					<FormField label="Name">
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Platform redesign"
						/>
					</FormField>
					<Button variant="primary" type="submit" disabled={!name.trim() || createWorkspace.isPending}>
						<Plus size={16} />
						<span>Create</span>
					</Button>
				</InlineForm>
				{createWorkspace.isError ?
					<FormError>{getErrorMessage(createWorkspace.error)}</FormError>
				:	null}
			</ToolPanel>

			{workspacesQuery.isError ?
				<ErrorPanel>{getErrorMessage(workspacesQuery.error)}</ErrorPanel>
			:	null}

			<ResourceGrid
				aria-label="Workspace list"
				isLoading={workspacesQuery.isPending}
				loadingMessage="Loading workspaces..."
				isEmpty={workspacesQuery.data?.length === 0}
				emptyMessage="No workspaces yet."
			>
				{workspacesQuery.data?.map((workspace) => (
					<ResourceCard
						key={workspace.id}
						icon={<FolderKanban size={18} />}
						actions={
							<>
								<ButtonLink size="compact" to={`/workspaces/${workspace.id}`}>
									Open
								</ButtonLink>
								{canDeleteWorkspace(workspace.role) ? <Button
									variant="icon"
									size="compact"
									tone="danger"
									type="button"
									onClick={() => deleteWorkspace.mutate(workspace.id)}
									aria-label={`Delete ${workspace.name}`}
								>
									<Trash2 size={16} />
								</Button> : null}
							</>
						}
					>
						<ResourceCardBody>
							<h2>{workspace.name}</h2>
							<p>{workspace.role ? `Role: ${workspace.role}` : "Workspace"}</p>
						</ResourceCardBody>
					</ResourceCard>
				))}
			</ResourceGrid>
			{deleteWorkspace.isError ?
				<FormError>{getErrorMessage(deleteWorkspace.error)}</FormError>
			:	null}
		</div>
	);
}
