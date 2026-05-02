import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { classNames } from "./classNames";
import styles from "./Form.module.css";

type InlineFormProps = ComponentPropsWithoutRef<"form">;

export function InlineForm({ className, ...props }: InlineFormProps) {
	return <form className={classNames(styles.inlineForm, className)} {...props} />;
}

type FormFieldProps = ComponentPropsWithoutRef<"label"> & {
	label: ReactNode;
};

export function FormField({ label, children, className, ...props }: FormFieldProps) {
	return (
		<label className={classNames(styles.field, className)} {...props}>
			<span>{label}</span>
			{children}
		</label>
	);
}

type FormErrorProps = ComponentPropsWithoutRef<"p">;

export function FormError({ className, ...props }: FormErrorProps) {
	return <p className={classNames(styles.error, className)} {...props} />;
}
