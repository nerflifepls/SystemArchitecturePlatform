import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { classNames } from "./classNames";
import { StatusPanel } from "./Panel";
import styles from "./Resource.module.css";

type ResourceGridProps = ComponentPropsWithoutRef<"section"> & {
	isLoading?: boolean;
	isEmpty?: boolean;
	loadingMessage?: string;
	emptyMessage?: string;
};

export function ResourceGrid({
	children,
	className,
	isLoading = false,
	isEmpty = false,
	loadingMessage = "Loading...",
	emptyMessage = "No items yet.",
	...props
}: ResourceGridProps) {
	return (
		<section className={classNames(styles.grid, className)} {...props}>
			{isLoading ?
				<StatusPanel className={styles.state}>{loadingMessage}</StatusPanel>
			:	null}
			{!isLoading && isEmpty ?
				<StatusPanel className={styles.state}>{emptyMessage}</StatusPanel>
			:	null}
			{children}
		</section>
	);
}

type ResourceCardProps = ComponentPropsWithoutRef<"article"> & {
	icon: ReactNode;
	visual?: ReactNode;
	actions?: ReactNode;
	message?: ReactNode;
};

export function ResourceCard({ icon, visual, actions, message, children, className, ...props }: ResourceCardProps) {
	return (
		<article className={classNames(styles.card, className)} {...props}>
			{visual ? <div className={styles.visual}>{visual}</div> : null}
			<div className={styles.content}>
				<div className={styles.icon}>{icon}</div>
				{children}
			</div>
			{actions ?
				<div className={styles.actions}>{actions}</div>
			:	null}
			{message ?
				<div className={styles.cardMessage}>{message}</div>
			:	null}
		</article>
	);
}

type ResourceCardBodyProps = ComponentPropsWithoutRef<"div">;

export function ResourceCardBody({ className, ...props }: ResourceCardBodyProps) {
	return <div className={classNames(styles.body, className)} {...props} />;
}
