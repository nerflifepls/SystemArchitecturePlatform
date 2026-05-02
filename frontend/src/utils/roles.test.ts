import { describe, expect, it } from "vitest";

import {
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
});
