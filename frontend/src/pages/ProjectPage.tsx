import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Clock3,
	Database,
	Edit3,
	FileSymlink,
	Maximize2,
	Monitor,
	Plus,
	Save,
	Settings2,
	ShieldCheck,
	Trash2,
	Waypoints,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";

import { diagramApi, projectApi, workspaceApi } from "../api/endpoints";
import type { DiagramDto, WorkspaceRole } from "../api/types";
import {
	Button,
	ButtonLink,
	ErrorPanel,
	FormError,
	FormField,
	PageHeader,
	ResourceCard,
	ResourceCardBody,
	ResourceGrid,
	ToolPanel,
} from "../components/ui";
import { getErrorMessage } from "../utils/errors";
import { formatUpdatedAt } from "../utils/format";
import { canDeleteWorkspaceContent, canEditWorkspaceContent, roleLabels } from "../utils/roles";
import styles from "./ProjectPage.module.css";

type DiagramCardProps = {
	diagram: DiagramDto;
	workspaceId: string;
	projectId: string;
	role?: WorkspaceRole;
};

function DiagramPreview() {
	return (
		<div className={styles.diagramPreview} aria-hidden="true">
			<span className={[styles.previewNode, styles.previewClient].join(" ")}><Monitor size={12} /></span>
			<span className={[styles.previewNode, styles.previewGateway].join(" ")}><Waypoints size={12} /></span>
			<span className={[styles.previewNode, styles.previewData].join(" ")}><Database size={12} /></span>
			<span className={[styles.previewEdge, styles.previewEdgeOne].join(" ")} />
			<span className={[styles.previewEdge, styles.previewEdgeTwo].join(" ")} />
			<span className={styles.previewCursor} />
		</div>
	);
}

function DiagramCard({ diagram, workspaceId, projectId, role }: DiagramCardProps) {
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
			className={styles.diagramCard}
			visual={<DiagramPreview />}
			icon={<FileSymlink size={18} />}
			actions={
				<>
					<ButtonLink
						size="compact"
						to={"/workspaces/" + workspaceId + "/projects/" + projectId + "/diagrams/" + diagram.id}
					>
						Details
					</ButtonLink>
					<ButtonLink
						variant="primary"
						size="compact"
						to={"/workspaces/" + workspaceId + "/projects/" + projectId + "/diagrams/" + diagram.id + "/editor"}
					>
						<Maximize2 size={15} />
						<span>Open editor</span>
					</ButtonLink>
					{canEditWorkspaceContent(role) ?
						<Button
							variant="icon"
							size="compact"
							type="button"
							onClick={() => setIsEditing((value) => !value)}
							aria-label="Edit diagram"
						>
							<Edit3 size={16} />
						</Button>
					: null}
					{canDeleteWorkspaceContent(role) ?
						<Button
							variant="icon"
							size="compact"
							tone="danger"
							type="button"
							onClick={() => deleteDiagram.mutate()}
							aria-label="Delete diagram"
						>
							<Trash2 size={16} />
						</Button>
					: null}
				</>
			}
			message={
				<>
					{updateDiagram.isError ? <FormError>{getErrorMessage(updateDiagram.error)}</FormError> : null}
					{deleteDiagram.isError ? <FormError>{getErrorMessage(deleteDiagram.error)}</FormError> : null}
				</>
			}
		>
			{isEditing ?
				<ResourceCardBody>
					<form className="edit-form" onSubmit={handleUpdateDiagram}>
						<FormField label="Diagram title">
							<input value={title} onChange={(event) => setTitle(event.target.value)} />
						</FormField>
						<div className="row-actions">
							<Button variant="primary" type="submit" disabled={!title.trim() || updateDiagram.isPending}>
								<Save size={15} />
								<span>Save</span>
							</Button>
							<Button type="button" onClick={() => setIsEditing(false)}>Cancel</Button>
						</div>
					</form>
				</ResourceCardBody>
			: <ResourceCardBody>
					<div className={styles.diagramMeta}>
						<span>Snapshot v{diagram.snapshotVersion ?? 1}</span>
						<span>{formatUpdatedAt(diagram.updatedAt)}</span>
					</div>
					<h2>{diagram.title}</h2>
					<p>{diagram.lastUpdateSeq ?? 0} saved updates · Collaborative canvas</p>
				</ResourceCardBody>}
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
	const workspaceQuery = useQuery({
		queryKey: ["workspace", workspaceId],
		queryFn: ({ signal }) => workspaceApi.get(workspaceId, signal),
		enabled: Boolean(workspaceId),
	});
	const canEditContent = canEditWorkspaceContent(workspaceQuery.data?.role);

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
		mutationFn: () => diagramApi.create({ projectId, title: diagramTitle.trim() }),
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

	const diagrams = diagramsQuery.data ?? [];
	const totalUpdates = diagrams.reduce((sum, diagram) => sum + (diagram.lastUpdateSeq ?? 0), 0);
	const roleLabel = workspaceQuery.data?.role ? roleLabels[workspaceQuery.data.role] : "Member";

	return (
		<div className={styles.page}>
			<PageHeader
				eyebrow="Project overview"
				title={projectQuery.data?.name ?? "Project"}
				description={projectQuery.data?.description || "Build, review, and maintain the diagrams for this system."}
				actions={
					<>
						<ButtonLink to={"/workspaces/" + workspaceId}>
							<ArrowLeft size={16} />
							<span>Workspace</span>
						</ButtonLink>
						<span className={styles.rolePill}><ShieldCheck size={14} /> {roleLabel}</span>
					</>
				}
			/>

			{projectQuery.isError ? <ErrorPanel>{getErrorMessage(projectQuery.error)}</ErrorPanel> : null}

			<section className={styles.summary} aria-label="Project summary">
				<article>
					<span className={styles.summaryIcon}><FileSymlink size={18} /></span>
					<div><strong>{diagrams.length}</strong><span>Diagrams</span></div>
				</article>
				<article>
					<span className={styles.summaryIcon}><Save size={18} /></span>
					<div><strong>{totalUpdates}</strong><span>Saved updates</span></div>
				</article>
				<article>
					<span className={styles.summaryIcon}><ShieldCheck size={18} /></span>
					<div><strong>{roleLabel}</strong><span>Your access</span></div>
				</article>
				<article>
					<span className={styles.summaryIcon}><Clock3 size={18} /></span>
					<div><strong>In sync</strong><span>{formatUpdatedAt(projectQuery.data?.updatedAt)}</span></div>
				</article>
			</section>

			<div className={canEditContent ? styles.projectLayout : styles.projectLayoutFull}>
				<section className={styles.diagramsSection} aria-labelledby="diagrams-title">
					<header className={styles.sectionHeading}>
						<div>
							<span className="eyebrow">Architecture canvases</span>
							<h2 id="diagrams-title">Diagrams</h2>
							<p>Open a canvas to continue designing with your team.</p>
						</div>
						{canEditContent ?
							<a className={styles.textAction} href="#new-diagram">
								<Plus size={15} />
								New diagram
							</a>
						: null}
					</header>

					{diagramsQuery.isError ? <ErrorPanel>{getErrorMessage(diagramsQuery.error)}</ErrorPanel> : null}

					<ResourceGrid
						className={styles.diagramGrid}
						aria-label="Diagram list"
						isLoading={diagramsQuery.isPending}
						loadingMessage="Loading diagrams..."
						isEmpty={diagramsQuery.data?.length === 0}
						emptyMessage="No diagrams yet. Create the first canvas for this project."
					>
						{diagrams.map((diagram) => (
							<DiagramCard
								key={diagram.id}
								diagram={diagram}
								workspaceId={workspaceId}
								projectId={projectId}
								role={workspaceQuery.data?.role}
							/>
						))}
					</ResourceGrid>
				</section>

				{canEditContent ?
					<aside className={styles.sideColumn} aria-label="Project tools">
						<ToolPanel id="new-diagram" className={styles.sidePanel} aria-labelledby="new-diagram-title">
							<div className={styles.panelHeading}>
								<span className={styles.panelIcon}><Plus size={17} /></span>
								<div>
									<span className="eyebrow">Create</span>
									<h2 id="new-diagram-title">New diagram</h2>
									<p>Start with a fresh collaborative canvas.</p>
								</div>
							</div>
							<form className={styles.stackForm} onSubmit={handleCreateDiagram}>
								<FormField label="Diagram title">
									<input
										value={diagramTitle}
										onChange={(event) => setDiagramTitle(event.target.value)}
										placeholder="e.g. Checkout context"
									/>
								</FormField>
								<Button variant="primary" type="submit" disabled={!diagramTitle.trim() || createDiagram.isPending}>
									<Plus size={16} />
									<span>{createDiagram.isPending ? "Creating..." : "Create diagram"}</span>
								</Button>
							</form>
							{createDiagram.isError ? <FormError>{getErrorMessage(createDiagram.error)}</FormError> : null}
						</ToolPanel>

						<ToolPanel className={styles.sidePanel} aria-labelledby="project-settings-title">
							<div className={styles.panelHeading}>
								<span className={styles.panelIcon}><Settings2 size={17} /></span>
								<div>
									<span className="eyebrow">Settings</span>
									<h2 id="project-settings-title">Project details</h2>
									<p>Keep the project context useful.</p>
								</div>
							</div>
							<form className={styles.stackForm} onSubmit={handleUpdateProject}>
								<FormField label="Project name">
									<input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
								</FormField>
								<FormField label="Description">
									<textarea
										value={projectDescription}
										onChange={(event) => setProjectDescription(event.target.value)}
									/>
								</FormField>
								<Button variant="secondary" type="submit" disabled={!projectName.trim() || updateProject.isPending}>
									<Save size={16} />
									<span>{updateProject.isPending ? "Saving..." : "Save changes"}</span>
								</Button>
							</form>
							{updateProject.isError ? <FormError>{getErrorMessage(updateProject.error)}</FormError> : null}
						</ToolPanel>
					</aside>
				: null}
			</div>
		</div>
	);
}
