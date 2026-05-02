import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { workspaceApi } from "../api/endpoints";
import { getErrorMessage } from "../utils/errors";

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
			<div className="page-heading">
				<div>
					<span className="eyebrow">Dashboard</span>
					<h1>Workspaces</h1>
				</div>
				<div className="page-actions">
					<span className="meta-pill">{workspacesQuery.data?.length ?? 0} workspaces</span>
				</div>
			</div>

			<section className="tool-panel" aria-labelledby="new-workspace-title">
				<div>
					<h2 id="new-workspace-title">New workspace</h2>
					<p className="muted-copy">Create a bounded area for projects, diagrams, and collaborators.</p>
				</div>
				<form className="inline-form" onSubmit={handleCreateWorkspace}>
					<label>
						<span>Name</span>
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Platform redesign"
						/>
					</label>
					<button
						className="primary-button"
						type="submit"
						disabled={!name.trim() || createWorkspace.isPending}
					>
						<Plus size={16} />
						<span>Create</span>
					</button>
				</form>
				{createWorkspace.isError ?
					<p className="form-error">{getErrorMessage(createWorkspace.error)}</p>
				:	null}
			</section>

			{workspacesQuery.isError ?
				<div className="error-panel">{getErrorMessage(workspacesQuery.error)}</div>
			:	null}

			<section className="resource-grid" aria-label="Workspace list">
				{workspacesQuery.isPending ?
					<div className="status-panel">Loading workspaces...</div>
				:	null}
				{workspacesQuery.data?.length === 0 ?
					<div className="status-panel">No workspaces yet.</div>
				:	null}
				{workspacesQuery.data?.map((workspace) => (
					<article className="resource-card" key={workspace.id}>
						<div className="card-icon">
							<FolderKanban size={18} />
						</div>
						<div className="resource-card-body">
							<h2>{workspace.name}</h2>
							<p>{workspace.role ? `Role: ${workspace.role}` : "Workspace"}</p>
						</div>
						<div className="card-actions">
							<Link className="secondary-button" to={`/workspaces/${workspace.id}`}>
								Open
							</Link>
							<button
								className="icon-button danger"
								type="button"
								onClick={() => deleteWorkspace.mutate(workspace.id)}
								aria-label={`Delete ${workspace.name}`}
							>
								<Trash2 size={16} />
							</button>
						</div>
					</article>
				))}
			</section>
			{deleteWorkspace.isError ?
				<p className="form-error">{getErrorMessage(deleteWorkspace.error)}</p>
			:	null}
		</div>
	);
}
