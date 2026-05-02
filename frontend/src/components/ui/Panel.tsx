import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { classNames } from "./classNames";
import styles from "./Panel.module.css";

type ToolPanelProps = ComponentPropsWithoutRef<"section">;

export function ToolPanel({ className, ...props }: ToolPanelProps) {
	return <section className={classNames(styles.panel, styles.tool, className)} {...props} />;
}

type StatusPanelProps = ComponentPropsWithoutRef<"div"> & {
	wide?: boolean;
};

export function StatusPanel({ className, wide = false, ...props }: StatusPanelProps) {
	return <div className={classNames(styles.panel, styles.status, wide && styles.wide, className)} {...props} />;
}

type ErrorPanelProps = ComponentPropsWithoutRef<"div"> & {
	error?: unknown;
	children?: ReactNode;
};

export function ErrorPanel({ className, ...props }: ErrorPanelProps) {
	return <div className={classNames(styles.panel, styles.error, className)} {...props} />;
}
