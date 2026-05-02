import { Link, type LinkProps } from "react-router-dom";
import type { ButtonHTMLAttributes } from "react";

import { classNames } from "./classNames";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "icon";
type ButtonTone = "neutral" | "danger";
type ButtonSize = "default" | "compact";

type ButtonStyleProps = {
	variant?: ButtonVariant;
	tone?: ButtonTone;
	size?: ButtonSize;
};

function buttonClasses(
	{ variant = "secondary", tone = "neutral", size = "default" }: ButtonStyleProps,
	className?: string,
) {
	return classNames(
		styles.button,
		styles[variant],
		tone === "danger" && styles.danger,
		size === "compact" && styles.compact,
		className,
	);
}

function linkClasses(
	{ variant = "secondary", tone = "neutral", size = "default" }: ButtonStyleProps,
	className?: string,
) {
	return classNames(
		styles.linkButton,
		styles[variant],
		tone === "danger" && styles.danger,
		size === "compact" && styles.compact,
		className,
	);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps;

export function Button({
	variant = "secondary",
	tone = "neutral",
	size = "default",
	className,
	...props
}: ButtonProps) {
	return <button className={buttonClasses({ variant, tone, size }, className)} {...props} />;
}

type ButtonLinkProps = LinkProps & ButtonStyleProps;

export function ButtonLink({
	variant = "secondary",
	tone = "neutral",
	size = "default",
	className,
	...props
}: ButtonLinkProps) {
	return <Link className={linkClasses({ variant, tone, size }, className)} {...props} />;
}
