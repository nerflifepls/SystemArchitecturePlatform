import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit3, FolderKanban, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { projectApi } from "../../api/endpoints";
import type { ProjectDto, WorkspaceRole } from "../../api/types";
import { Button, ButtonLink, FormError, FormField, ResourceCard, ResourceCardBody } from "../ui";
import { getErrorMessage } from "../../utils/errors";
import { canDeleteWorkspaceContent, canEditWorkspaceContent } from "../../utils/roles";

type ProjectCardProps = {
	project: ProjectDto;
	workspaceId: string;
	role?: WorkspaceRole;
};

export function ProjectCard({ project, workspaceId, role }: ProjectCardProps) {
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
		<ResourceCard
			icon={<FolderKanban size={18} />}
			actions={
				<>
					<ButtonLink size="compact" to={`/workspaces/${workspaceId}/projects/${project.id}`}>
						Open
					</ButtonLink>
					{canEditWorkspaceContent(role) ? <Button
						variant="icon"
						size="compact"
						type="button"
						onClick={() => setIsEditing((value) => !value)}
						aria-label="Edit project"
					>
						<Edit3 size={16} />
					</Button> : null}
					{canDeleteWorkspaceContent(role) ? <Button
						variant="icon"
						size="compact"
						tone="danger"
						type="button"
						onClick={() => deleteProject.mutate()}
						aria-label="Delete project"
					>
						<Trash2 size={16} />
					</Button> : null}
				</>
			}
			message={
				<>
					{updateProject.isError ?
						<FormError>{getErrorMessage(updateProject.error)}</FormError>
					:	null}
					{deleteProject.isError ?
						<FormError>{getErrorMessage(deleteProject.error)}</FormError>
					:	null}
				</>
			}
		>
			{isEditing ?
				<ResourceCardBody>
					<form className="edit-form" onSubmit={handleUpdateProject}>
						<FormField label="Name">
							<input value={name} onChange={(event) => setName(event.target.value)} />
						</FormField>
						<FormField label="Description">
							<input value={description} onChange={(event) => setDescription(event.target.value)} />
						</FormField>
						<div className="row-actions">
							<Button variant="primary" type="submit" disabled={!name.trim() || updateProject.isPending}>
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
					<h2>{project.name}</h2>
					<p>{project.description || "No description"}</p>
				</ResourceCardBody>
			}
		</ResourceCard>
	);
}
