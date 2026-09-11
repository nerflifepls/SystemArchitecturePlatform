import { describe, expect, it } from "vitest";

import { createDiagramDocument, parseDiagramDocument, renderDiagramPdf, renderDiagramSvg } from "./diagramDocument";
import type { DiagramEdge, DiagramNode } from "./diagramEditorModel";

const nodes: DiagramNode[] = [
	{ id: "client", type: "default", position: { x: 40, y: 80 }, data: { label: "Client app", kind: "client" } },
	{ id: "api", type: "default", position: { x: 360, y: 80 }, data: { label: "Backend API", kind: "service" } },
];
const edges: DiagramEdge[] = [{ id: "edge", source: "client", target: "api", sourceHandle: "right", targetHandle: "left", label: "HTTPS" }];

describe("portable diagram documents", () => {
	it("round-trips a versioned JSON document", () => {
		const documentModel = createDiagramDocument("Thesis architecture", nodes, edges, []);
		const parsed = parseDiagramDocument(JSON.stringify(documentModel));
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.diagram.nodes).toHaveLength(2);
		expect(parsed.diagram.edges[0].sourceHandle).toBe("right");
	});

	it("rejects connections to missing nodes", () => {
		const documentModel = createDiagramDocument("Broken", nodes, edges, []);
		documentModel.diagram.edges[0].target = "missing";
		expect(() => parseDiagramDocument(JSON.stringify(documentModel))).toThrow("missing node");
	});

	it("renders standalone SVG and PDF artifacts", () => {
		const documentModel = createDiagramDocument("Thesis architecture", nodes, edges, []);
		const svg = renderDiagramSvg(documentModel);
		const pdf = new TextDecoder().decode(renderDiagramPdf(documentModel));
		expect(svg).toContain("Thesis architecture");
		expect(svg).toContain("marker-end=\"url(#arrow)\"");
		expect(pdf.startsWith("%PDF-1.4")).toBe(true);
	});

	it("preserves resized boundaries in JSON and visual exports", () => {
		const boundary: DiagramNode = {
			id: "boundary",
			type: "boundary",
			position: { x: 10, y: 20 },
			width: 760,
			height: 510,
			data: { label: "Production zone", kind: "boundary" },
		};
		const documentModel = createDiagramDocument("Bounded system", [...nodes, boundary], edges, []);
		const parsed = parseDiagramDocument(JSON.stringify(documentModel));

		expect(parsed.diagram.nodes.find((node) => node.id === "boundary")?.size).toEqual({
			width: 760,
			height: 510,
		});
		expect(renderDiagramSvg(parsed)).toContain('width="760" height="510"');
	});
});
