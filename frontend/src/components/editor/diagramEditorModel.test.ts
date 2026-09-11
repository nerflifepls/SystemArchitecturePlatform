import { describe, expect, it } from "vitest";

import {
	BOUNDARY_DEFAULT_SIZE,
	BOUNDARY_MAX_SIZE,
	BOUNDARY_MIN_SIZE,
	DIAGRAM_EDGE_TYPE,
	clampBoundarySize,
	normalizeHandleId,
	snapNodePosition,
	toFlowEdge,
	toFlowNode,
	toStoredEdge,
	toStoredNode,
	type DiagramNode,
} from "./diagramEditorModel";

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

	it("round-trips resizable boundary dimensions", () => {
		const flowNode = toFlowNode({
			id: "boundary",
			type: "boundary",
			position: { x: 80, y: 90 },
			data: { label: "Trust zone", kind: "boundary" },
			size: { width: 780, height: 520 },
		});

		expect({ width: flowNode.width, height: flowNode.height }).toEqual({ width: 780, height: 520 });
		expect(toStoredNode(flowNode).size).toEqual({ width: 780, height: 520 });
	});

	it("provides safe defaults and limits for boundary dimensions", () => {
		const legacyBoundary = toFlowNode({
			id: "legacy-boundary",
			type: "boundary",
			position: { x: 0, y: 0 },
			data: { label: "Legacy", kind: "boundary" },
		});

		expect({ width: legacyBoundary.width, height: legacyBoundary.height }).toEqual(BOUNDARY_DEFAULT_SIZE);
		expect(clampBoundarySize({ width: 20, height: 4000 })).toEqual({
			width: BOUNDARY_MIN_SIZE.width,
			height: BOUNDARY_MAX_SIZE.height,
		});
	});
});
