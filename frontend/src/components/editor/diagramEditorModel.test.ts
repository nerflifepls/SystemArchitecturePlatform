import { describe, expect, it } from "vitest";

import { DIAGRAM_EDGE_TYPE, normalizeHandleId, snapNodePosition, toFlowEdge, toStoredEdge, type DiagramNode } from "./diagramEditorModel";

describe("diagram edge routing", () => {
	it("restores rounded orthogonal routing for saved edges", () => {
		const edge = toFlowEdge({
			id: "edge-1",
			source: "source",
			target: "target",
			type: "smoothstep",
		});

		expect(edge.type).toBe(DIAGRAM_EDGE_TYPE);
	});

	it("persists the shared rounded routing type", () => {
		const edge = toStoredEdge({
			id: "edge-1",
			source: "source",
			target: "target",
			type: "smoothstep",
		});

		expect(edge.type).toBe(DIAGRAM_EDGE_TYPE);
	});

	it("migrates old directional input and output handles", () => {
		expect(normalizeHandleId("top-source")).toBe("top");
		expect(normalizeHandleId("right-target")).toBe("right");
		expect(normalizeHandleId("bottom")).toBe("bottom");
	});

	it("does not snap components to visual boundary coordinates", () => {
		const nodes: DiagramNode[] = [
			{ id: "boundary", type: "boundary", position: { x: 100, y: 100 }, data: { label: "Zone", kind: "boundary" } },
			{ id: "service", type: "default", position: { x: 112, y: 113 }, data: { label: "API", kind: "service" } },
		];
		expect(snapNodePosition("service", { x: 108, y: 109 }, nodes)).toEqual({ x: 108, y: 109 });
		expect(snapNodePosition("boundary", { x: 115, y: 116 }, nodes)).toEqual({ x: 115, y: 116 });
	});
});
