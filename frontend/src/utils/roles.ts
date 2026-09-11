import type { WorkspaceRole } from "../api/types";

export type InviteRole = Exclude<WorkspaceRole, "owner">;

export const roleLabels: Record<WorkspaceRole, string> = {
	owner: "Owner",
	admin: "Admin",
	editor: "Editor",
	viewer: "Viewer",
};

export const inviteRoleOptions: Array<{ value: InviteRole; label: string }> = [
	{ value: "admin", label: roleLabels.admin },
	{ value: "editor", label: roleLabels.editor },
	{ value: "viewer", label: roleLabels.viewer },
];

export const memberRoleOptions: Array<{ value: WorkspaceRole; label: string }> = [
	{ value: "owner", label: roleLabels.owner },
	{ value: "admin", label: roleLabels.admin },
	{ value: "editor", label: roleLabels.editor },
	{ value: "viewer", label: roleLabels.viewer },
];

export function getMemberInitials(name: string, email: string) {
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

export function canManageWorkspaceMembers(role: WorkspaceRole | undefined) {
	return role === "owner" || role === "admin";
}

export function canEditWorkspaceContent(role: WorkspaceRole | undefined) {
	return role === "owner" || role === "admin" || role === "editor";
}

export function canDeleteWorkspaceContent(role: WorkspaceRole | undefined) {
	return role === "owner" || role === "admin";
}

export function canDeleteWorkspace(role: WorkspaceRole | undefined) {
	return role === "owner";
}
