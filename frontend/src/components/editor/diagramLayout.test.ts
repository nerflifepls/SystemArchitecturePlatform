import { describe, expect, it } from "vitest";

import type { DiagramEdge, DiagramNode } from "./diagramEditorModel";
import { alignDiagramNodes, autoLayoutDiagram } from "./diagramLayout";

function node(id: string, x: number, y: number): DiagramNode {
	return { id, type: "default", position: { x, y }, data: { label: id, kind: "service" } };
}

describe("diagram organization", () => {
	it("places dependencies in deterministic left-to-right ranks", () => {
		const nodes = [node("client", 500, 500), node("api", 0, 0), node("db", 200, 20)];
		const edges: DiagramEdge[] = [
			{ id: "a", source: "client", target: "api" },
			{ id: "b", source: "api", target: "db" },
		];
		const result = autoLayoutDiagram(nodes, edges);
		const positions = Object.fromEntries(result.map((item) => [item.id, item.position]));
		expect(positions.client.x).toBeLessThan(positions.api.x);
		expect(positions.api.x).toBeLessThan(positions.db.x);
	});

	it("aligns only the selected nodes", () => {
		const result = alignDiagramNodes([node("a", 10, 20), node("b", 40, 60), node("c", 90, 120)], new Set(["a", "b"]), "horizontal");
		expect(result.find((item) => item.id === "a")?.position.y).toBe(40);
		expect(result.find((item) => item.id === "b")?.position.y).toBe(40);
		expect(result.find((item) => item.id === "c")?.position.y).toBe(120);
	});

	it("leaves visual boundaries in place during automatic layout", () => {
		const boundary = { ...node("boundary", 33, 44), type: "boundary" };
		const result = autoLayoutDiagram([boundary, node("service", 500, 500)], []);
		expect(result.find((item) => item.id === "boundary")?.position).toEqual({ x: 33, y: 44 });
	});
});
