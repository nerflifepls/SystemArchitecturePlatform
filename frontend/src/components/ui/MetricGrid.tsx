import type { ReactNode } from "react";

import styles from "./MetricGrid.module.css";

type Metric = {
	label: ReactNode;
	value: ReactNode;
};

type MetricGridProps = {
	items: Metric[];
};

export function MetricGrid({ items }: MetricGridProps) {
	return (
		<div className={styles.grid}>
			{items.map((item, index) => (
				<Fragment key={index} label={item.label} value={item.value} />
			))}
		</div>
	);
}

function Fragment({ label, value }: Metric) {
	return (
		<>
			<span className={styles.label}>{label}</span>
			<strong className={styles.value}>{value}</strong>
		</>
	);
}
