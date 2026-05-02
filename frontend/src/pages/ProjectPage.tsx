import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, FileSymlink, Maximize2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { diagramApi, projectApi } from "../api/endpoints";
import type { DiagramDto } from "../api/types";
import { getErrorMessage } from "../utils/errors";

type DiagramCardProps = {
	diagram: DiagramDto;
	workspaceId: string;
	projectId: string;
};

function DiagramCard({ diagram, workspaceId, projectId }: DiagramCardProps) {
	const queryClient = useQueryClient();
	const [isEditing, setIsEditing] = useState(false);
	const [title, setTitle] = useState(diagram.title);

	const updateDiagram = useMutation({
		mutationFn: () => diagramApi.update(diagram.id, { title: title.trim() }),
		onSuccess: () => {
			setIsEditing(false);
			void queryClient.invalidateQueries({ queryKey: ["diagrams", projectId] });
			void queryClient.invalidateQueries({ queryKey: ["diagram", diagram.id] });
		},
	});

	const deleteDiagram = useMutation({
		mutationFn: () => diagramApi.remove(diagram.id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["diagrams", projectId] });
		},
	});

	function handleUpdateDiagram(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (title.trim()) {
			updateDiagram.mutate();
		}
	}

	return (
		<article className="resource-card">
			<div className="card-icon">
				<FileSymlink size={18} />
			</div>
			{isEditing ?
				<form className="resource-card-body edit-form" onSubmit={handleUpdateDiagram}>
					<label>
						<span>Title</span>
						<input value={title} onChange={(event) => setTitle(event.target.value)} />
					</label>
					<div className="row-actions">
						<button
							className="primary-button"
							type="submit"
							disabled={!title.trim() || updateDiagram.isPending}
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
					<h2>{diagram.title}</h2>
					<p>Snapshot v{diagram.snapshotVersion ?? 1}</p>
					<span className="meta-pill">seq {diagram.lastUpdateSeq ?? 0}</span>
				</div>
			}
			<div className="card-actions">
				<Link
					className="secondary-button"
					to={`/workspaces/${workspaceId}/projects/${projectId}/diagrams/${diagram.id}`}
				>
					Details
				</Link>
				<Link
					className="primary-button"
					to={`/workspaces/${workspaceId}/projects/${projectId}/diagrams/${diagram.id}/editor`}
				>
					<Maximize2 size={16} />
					<span>Editor</span>
				</Link>
				<button
					className="icon-button"
					type="button"
					onClick={() => setIsEditing((value) => !value)}
					aria-label="Edit diagram"
				>
					<Edit3 size={16} />
				</button>
				<button
					className="icon-button danger"
					type="button"
					onClick={() => deleteDiagram.mutate()}
					aria-label="Delete diagram"
				>
					<Trash2 size={16} />
				</button>
			</div>
			{updateDiagram.isError ?
				<p className="form-error card-message">{getErrorMessage(updateDiagram.error)}</p>
			:	null}
			{deleteDiagram.isError ?
				<p className="form-error card-message">{getErrorMessage(deleteDiagram.error)}</p>
			:	null}
		</article>
	);
}

export function ProjectPage() {
	const { workspaceId = "", projectId = "" } = useParams();
	const queryClient = useQueryClient();
	const [projectName, setProjectName] = useState("");
	const [projectDescription, setProjectDescription] = useState("");
	const [diagramTitle, setDiagramTitle] = useState("");

	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: ({ signal }) => projectApi.get(projectId, signal),
		enabled: Boolean(projectId),
	});

	const diagramsQuery = useQuery({
		queryKey: ["diagrams", projectId],
		queryFn: ({ signal }) => diagramApi.list(projectId, signal),
		enabled: Boolean(projectId),
	});

	useEffect(() => {
		if (projectQuery.data) {
			setProjectName(projectQuery.data.name);
			setProjectDescription(projectQuery.data.description ?? "");
		}
	}, [projectQuery.data]);

	const updateProject = useMutation({
		mutationFn: () =>
			projectApi.update(projectId, {
				name: projectName.trim(),
				description: projectDescription.trim() || undefined,
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
			void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
		},
	});

	const createDiagram = useMutation({
		mutationFn: () =>
			diagramApi.create({
				projectId,
				title: diagramTitle.trim(),
			}),
		onSuccess: () => {
			setDiagramTitle("");
			void queryClient.invalidateQueries({ queryKey: ["diagrams", projectId] });
		},
	});

	function handleUpdateProject(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (projectName.trim()) {
			updateProject.mutate();
		}
	}

	function handleCreateDiagram(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (diagramTitle.trim()) {
			createDiagram.mutate();
		}
	}

	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<span className="eyebrow">Project</span>
					<h1>{projectQuery.data?.name ?? "Project"}</h1>
				</div>
				<div className="page-actions">
					<span className="meta-pill">{diagramsQuery.data?.length ?? 0} diagrams</span>
				</div>
			</div>

			{projectQuery.isError ?
				<div className="error-panel">{getErrorMessage(projectQuery.error)}</div>
			:	null}

			<section className="tool-panel" aria-labelledby="project-settings-title">
				<div>
					<h2 id="project-settings-title">Project details</h2>
					<p className="muted-copy">Keep project naming aligned with the design effort.</p>
				</div>
				<form className="inline-form" onSubmit={handleUpdateProject}>
					<label>
						<span>Name</span>
						<input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
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
						disabled={!projectName.trim() || updateProject.isPending}
					>
						<Save size={16} />
						<span>Save</span>
					</button>
				</form>
				{updateProject.isError ?
					<p className="form-error">{getErrorMessage(updateProject.error)}</p>
				:	null}
			</section>

			<section className="tool-panel" aria-labelledby="new-diagram-title">
				<div>
					<h2 id="new-diagram-title">New diagram</h2>
					<p className="muted-copy">Create an editable collaborative graph document.</p>
				</div>
				<form className="inline-form" onSubmit={handleCreateDiagram}>
					<label>
						<span>Title</span>
						<input
							value={diagramTitle}
							onChange={(event) => setDiagramTitle(event.target.value)}
							placeholder="Checkout context"
						/>
					</label>
					<button
						className="primary-button"
						type="submit"
						disabled={!diagramTitle.trim() || createDiagram.isPending}
					>
						<Plus size={16} />
						<span>Create</span>
					</button>
				</form>
				{createDiagram.isError ?
					<p className="form-error">{getErrorMessage(createDiagram.error)}</p>
				:	null}
			</section>

			{diagramsQuery.isError ?
				<div className="error-panel">{getErrorMessage(diagramsQuery.error)}</div>
			:	null}

			<section className="resource-grid" aria-label="Diagram list">
				{diagramsQuery.isPending ?
					<div className="status-panel">Loading diagrams...</div>
				:	null}
				{diagramsQuery.data?.length === 0 ?
					<div className="status-panel">No diagrams yet.</div>
				:	null}
				{diagramsQuery.data?.map((diagram) => (
					<DiagramCard key={diagram.id} diagram={diagram} workspaceId={workspaceId} projectId={projectId} />
				))}
			</section>
		</div>
	);
}
