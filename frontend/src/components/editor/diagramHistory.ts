import type { DiagramSnapshotDto } from "../../api/types";

export type DiagramHistoryFilter = "all" | "manual" | "automatic";
export type DiagramSaveKind = Exclude<DiagramHistoryFilter, "all">;

export function getDiagramSaveKind(snapshot: Pick<DiagramSnapshotDto, "reason">): DiagramSaveKind {
	return snapshot.reason === "automatic" || snapshot.reason === "initial" ? "automatic" : "manual";
}

export function filterDiagramHistory(items: DiagramSnapshotDto[], filter: DiagramHistoryFilter) {
	return filter === "all" ? items : items.filter((snapshot) => getDiagramSaveKind(snapshot) === filter);
}

export function countDiagramHistoryKinds(items: DiagramSnapshotDto[]) {
	return items.reduce(
		(counts, snapshot) => {
			counts[getDiagramSaveKind(snapshot)] += 1;
			return counts;
		},
		{ manual: 0, automatic: 0 } satisfies Record<DiagramSaveKind, number>,
	);
}
