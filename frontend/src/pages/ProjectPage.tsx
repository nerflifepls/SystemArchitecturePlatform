import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, FileSymlink, Maximize2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";

import { diagramApi, projectApi } from "../api/endpoints";
import type { DiagramDto } from "../api/types";
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
		<ResourceCard
			icon={<FileSymlink size={18} />}
			actions={
				<>
					<ButtonLink to={`/workspaces/${workspaceId}/projects/${projectId}/diagrams/${diagram.id}`}>
						Details
					</ButtonLink>
					<ButtonLink
						variant="primary"
						to={`/workspaces/${workspaceId}/projects/${projectId}/diagrams/${diagram.id}/editor`}
					>
						<Maximize2 size={16} />
						<span>Editor</span>
					</ButtonLink>
					<Button
						variant="icon"
						type="button"
						onClick={() => setIsEditing((value) => !value)}
						aria-label="Edit diagram"
					>
						<Edit3 size={16} />
					</Button>
					<Button
						variant="icon"
						tone="danger"
						type="button"
						onClick={() => deleteDiagram.mutate()}
						aria-label="Delete diagram"
					>
						<Trash2 size={16} />
					</Button>
				</>
			}
			message={
				<>
					{updateDiagram.isError ?
						<FormError>{getErrorMessage(updateDiagram.error)}</FormError>
					:	null}
					{deleteDiagram.isError ?
						<FormError>{getErrorMessage(deleteDiagram.error)}</FormError>
					:	null}
				</>
			}
		>
			{isEditing ?
				<ResourceCardBody>
					<form className="edit-form" onSubmit={handleUpdateDiagram}>
						<FormField label="Title">
							<input value={title} onChange={(event) => setTitle(event.target.value)} />
						</FormField>
						<div className="row-actions">
							<Button variant="primary" type="submit" disabled={!title.trim() || updateDiagram.isPending}>
								<Save size={15} />
								<span>Save</span>
							</Button>
							<Button type="button" onClick={() => setIsEditing(false)}>
								Cancel
							</Button>
						</div>
					</form>
				</ResourceCardBody>
			:	<ResourceCardBody>
					<h2>{diagram.title}</h2>
					<p>Snapshot v{diagram.snapshotVersion ?? 1}</p>
					<span className="meta-pill">seq {diagram.lastUpdateSeq ?? 0}</span>
				</ResourceCardBody>
			}
		</ResourceCard>
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
			<PageHeader
				eyebrow="Project"
				title={projectQuery.data?.name ?? "Project"}
				actions={<span className="meta-pill">{diagramsQuery.data?.length ?? 0} diagrams</span>}
			/>

			{projectQuery.isError ?
				<ErrorPanel>{getErrorMessage(projectQuery.error)}</ErrorPanel>
			:	null}

			<ToolPanel aria-labelledby="project-settings-title">
				<div>
					<h2 id="project-settings-title">Project details</h2>
					<p className="muted-copy">Keep project naming aligned with the design effort.</p>
				</div>
				<InlineForm onSubmit={handleUpdateProject}>
					<FormField label="Name">
						<input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
					</FormField>
					<FormField label="Description">
						<input
							value={projectDescription}
							onChange={(event) => setProjectDescription(event.target.value)}
						/>
					</FormField>
					<Button variant="primary" type="submit" disabled={!projectName.trim() || updateProject.isPending}>
						<Save size={16} />
						<span>Save</span>
					</Button>
				</InlineForm>
				{updateProject.isError ?
					<FormError>{getErrorMessage(updateProject.error)}</FormError>
				:	null}
			</ToolPanel>

			<ToolPanel aria-labelledby="new-diagram-title">
				<div>
					<h2 id="new-diagram-title">New diagram</h2>
					<p className="muted-copy">Create an editable collaborative graph document.</p>
				</div>
				<InlineForm onSubmit={handleCreateDiagram}>
					<FormField label="Title">
						<input
							value={diagramTitle}
							onChange={(event) => setDiagramTitle(event.target.value)}
							placeholder="Checkout context"
						/>
					</FormField>
					<Button variant="primary" type="submit" disabled={!diagramTitle.trim() || createDiagram.isPending}>
						<Plus size={16} />
						<span>Create</span>
					</Button>
				</InlineForm>
				{createDiagram.isError ?
					<FormError>{getErrorMessage(createDiagram.error)}</FormError>
				:	null}
			</ToolPanel>

			{diagramsQuery.isError ?
				<ErrorPanel>{getErrorMessage(diagramsQuery.error)}</ErrorPanel>
			:	null}

			<ResourceGrid
				aria-label="Diagram list"
				isLoading={diagramsQuery.isPending}
				loadingMessage="Loading diagrams..."
				isEmpty={diagramsQuery.data?.length === 0}
				emptyMessage="No diagrams yet."
			>
				{diagramsQuery.data?.map((diagram) => (
					<DiagramCard key={diagram.id} diagram={diagram} workspaceId={workspaceId} projectId={projectId} />
				))}
			</ResourceGrid>
		</div>
	);
}
