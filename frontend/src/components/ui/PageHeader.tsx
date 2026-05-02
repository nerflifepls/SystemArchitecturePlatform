import type { ReactNode } from "react";

import styles from "./PageHeader.module.css";

type PageHeaderProps = {
	eyebrow: string;
	title: ReactNode;
	actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, actions }: PageHeaderProps) {
	return (
		<div className={styles.header}>
			<div className={styles.titleStack}>
				<span className="eyebrow">{eyebrow}</span>
				<h1>{title}</h1>
			</div>
			{actions ?
				<div className={styles.actions}>{actions}</div>
			:	null}
		</div>
	);
}
