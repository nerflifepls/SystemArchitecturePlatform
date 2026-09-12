import type { ReactNode } from "react";

import styles from "./PageHeader.module.css";

type PageHeaderProps = {
	eyebrow: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
	return (
		<header className={styles.header}>
			<div className={styles.titleStack}>
				<span className="eyebrow">{eyebrow}</span>
				<h1>{title}</h1>
				{description ? <p>{description}</p> : null}
			</div>
			{actions ?
				<div className={styles.actions}>{actions}</div>
			:	null}
		</header>
	);
}
