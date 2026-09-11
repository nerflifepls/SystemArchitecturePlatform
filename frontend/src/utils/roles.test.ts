import { describe, expect, it } from "vitest";

import {
	canDeleteWorkspace,
	canDeleteWorkspaceContent,
	canEditWorkspaceContent,
	canManageWorkspaceMembers,
	getMemberInitials,
	inviteRoleOptions,
	memberRoleOptions,
	roleLabels,
} from "./roles";

describe("role helpers", () => {
	it("formats role labels and options consistently", () => {
		expect(roleLabels.owner).toBe("Owner");
		expect(inviteRoleOptions.map((option) => option.value)).toEqual(["admin", "editor", "viewer"]);
		expect(memberRoleOptions.map((option) => option.value)).toEqual(["owner", "admin", "editor", "viewer"]);
	});

	it("derives member initials from names, emails, and empty values", () => {
		expect(getMemberInitials("Ada Lovelace", "ada@example.com")).toBe("AL");
		expect(getMemberInitials("", "grace@example.com")).toBe("GE");
		expect(getMemberInitials("", "")).toBe("?");
	});

	it("allows only owners and admins to manage workspace members", () => {
		expect(canManageWorkspaceMembers("owner")).toBe(true);
		expect(canManageWorkspaceMembers("admin")).toBe(true);
		expect(canManageWorkspaceMembers("editor")).toBe(false);
		expect(canManageWorkspaceMembers("viewer")).toBe(false);
		expect(canManageWorkspaceMembers(undefined)).toBe(false);
	});

	it("matches content permissions enforced by the API", () => {
		expect(canEditWorkspaceContent("owner")).toBe(true);
		expect(canEditWorkspaceContent("admin")).toBe(true);
		expect(canEditWorkspaceContent("editor")).toBe(true);
		expect(canEditWorkspaceContent("viewer")).toBe(false);
		expect(canDeleteWorkspaceContent("owner")).toBe(true);
		expect(canDeleteWorkspaceContent("admin")).toBe(true);
		expect(canDeleteWorkspaceContent("editor")).toBe(false);
		expect(canDeleteWorkspace("owner")).toBe(true);
		expect(canDeleteWorkspace("admin")).toBe(false);
	});
});
