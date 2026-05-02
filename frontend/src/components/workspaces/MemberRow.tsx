import { Trash2 } from "lucide-react";

import type { WorkspaceMemberDto, WorkspaceRole } from "../../api/types";
import { getMemberInitials, memberRoleOptions, roleLabels } from "../../utils/roles";
import { Button } from "../ui";
import styles from "./MemberRow.module.css";

type MemberRowProps = {
	member: WorkspaceMemberDto;
	canManageMembers: boolean;
	cannotChangeLastOwner: boolean;
	isUpdatingRole: boolean;
	isRemovingMember: boolean;
	onChangeRole: (userId: string, role: WorkspaceRole) => void;
	onRemove: (userId: string) => void;
};

export function MemberRow({
	member,
	canManageMembers,
	cannotChangeLastOwner,
	isUpdatingRole,
	isRemovingMember,
	onChangeRole,
	onRemove,
}: MemberRowProps) {
	const displayName = member.user.name || member.user.email;

	return (
		<article className={styles.row}>
			<div className={styles.identity}>
				{member.user.avatarUrl ?
					<img className={styles.avatar} src={member.user.avatarUrl} alt="" />
				:	<span className={styles.avatar} aria-hidden="true">
						{getMemberInitials(member.user.name, member.user.email)}
					</span>
				}
				<div className={styles.copy}>
					<strong>{displayName}</strong>
					<span>{member.user.email}</span>
				</div>
			</div>

			{canManageMembers ?
				<div className={styles.controls}>
					<select
						value={member.role}
						disabled={isUpdatingRole || cannotChangeLastOwner}
						onChange={(event) => onChangeRole(member.user.id, event.target.value as WorkspaceRole)}
					>
						{memberRoleOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<Button
						variant="icon"
						tone="danger"
						type="button"
						onClick={() => onRemove(member.user.id)}
						disabled={isRemovingMember || cannotChangeLastOwner}
						aria-label={`Remove ${displayName}`}
					>
						<Trash2 size={16} />
					</Button>
				</div>
			:	<span className={styles.badge}>{roleLabels[member.role]}</span>}
		</article>
	);
}
