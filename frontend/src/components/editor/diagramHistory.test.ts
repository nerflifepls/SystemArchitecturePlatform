import { describe, expect, it } from "vitest";

import type { DiagramSnapshotDto } from "../../api/types";
import { countDiagramHistoryKinds, filterDiagramHistory, getDiagramSaveKind } from "./diagramHistory";

function snapshot(snapshotVersion: number, reason: DiagramSnapshotDto["reason"]): DiagramSnapshotDto {
	return {
		diagramId: "diagram-1",
		snapshotVersion,
		baseUpdateSeq: snapshotVersion,
		byteSize: 128,
		name: "",
		reason,
		createdBy: "user-1",
		authorName: "Researcher",
		createdAt: "2026-09-12T10:00:00.000Z",
	};
}

describe("diagram history filters", () => {
	const history = [
		snapshot(1, "initial"),
		snapshot(2, "automatic"),
		snapshot(3, "manual"),
		snapshot(4, "restore"),
		snapshot(5, "import"),
	];

	it("classifies every system-created snapshot as automatic", () => {
		expect(getDiagramSaveKind(history[0])).toBe("automatic");
		expect(getDiagramSaveKind(history[1])).toBe("automatic");
	});

	it("classifies explicit user actions as manual", () => {
		expect(history.slice(2).map(getDiagramSaveKind)).toEqual(["manual", "manual", "manual"]);
	});

	it("filters snapshots without dropping special save reasons", () => {
		expect(filterDiagramHistory(history, "all")).toBe(history);
		expect(filterDiagramHistory(history, "automatic").map((item) => item.snapshotVersion)).toEqual([1, 2]);
		expect(filterDiagramHistory(history, "manual").map((item) => item.snapshotVersion)).toEqual([3, 4, 5]);
		expect(countDiagramHistoryKinds(history)).toEqual({ manual: 3, automatic: 2 });
	});
});
