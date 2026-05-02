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
				<StatusPanel>{loadingMessage}</StatusPanel>
			:	null}
			{!isLoading && isEmpty ?
				<StatusPanel>{emptyMessage}</StatusPanel>
			:	null}
			{children}
		</section>
	);
}

type ResourceCardProps = ComponentPropsWithoutRef<"article"> & {
	icon: ReactNode;
	actions?: ReactNode;
	message?: ReactNode;
};

export function ResourceCard({ icon, actions, message, children, className, ...props }: ResourceCardProps) {
	return (
		<article className={classNames(styles.card, className)} {...props}>
			<div className={styles.icon}>{icon}</div>
			{children}
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
