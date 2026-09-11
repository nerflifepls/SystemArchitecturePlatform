import { describe, expect, it } from "vitest";

import { DIAGRAM_EDGE_TYPE, toFlowEdge, toStoredEdge } from "./diagramEditorModel";

describe("diagram edge routing", () => {
	it("normalizes previously saved routes to straight lines", () => {
		const edge = toFlowEdge({
			id: "edge-1",
			source: "source",
			target: "target",
			type: "smoothstep",
		});

		expect(edge.type).toBe(DIAGRAM_EDGE_TYPE);
	});

	it("persists the shared straight-line route", () => {
		const edge = toStoredEdge({
			id: "edge-1",
			source: "source",
			target: "target",
			type: "smoothstep",
		});

		expect(edge.type).toBe(DIAGRAM_EDGE_TYPE);
	});
});
