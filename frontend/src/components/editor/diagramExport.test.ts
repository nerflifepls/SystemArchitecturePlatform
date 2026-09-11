import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDiagramDocument, exportDiagram } from "./diagramDocument";
import type { DiagramNode } from "./diagramEditorModel";

const exportMocks = vi.hoisted(() => ({
	toBlob: vi.fn(),
	toPng: vi.fn(),
	toSvg: vi.fn(),
	addImage: vi.fn(),
	outputPdf: vi.fn(),
	setPdfProperties: vi.fn(),
}));

vi.mock("html-to-image", () => ({
	toBlob: exportMocks.toBlob,
	toPng: exportMocks.toPng,
	toSvg: exportMocks.toSvg,
}));

vi.mock("jspdf", () => ({
	jsPDF: class MockPdf {
		internal = {
			pageSize: {
				getWidth: () => 960,
				getHeight: () => 640,
			},
		};

		addImage = exportMocks.addImage;
		output = exportMocks.outputPdf;
		setProperties = exportMocks.setPdfProperties;
	},
}));

const diagramNodes: DiagramNode[] = [
	{
		id: "service",
		type: "default",
		position: { x: 100, y: 80 },
		data: { label: "API", kind: "service" },
	},
];

function exportSurface() {
	const element = document.createElement("div");
	Object.defineProperties(element, {
		clientWidth: { configurable: true, value: 960 },
		clientHeight: { configurable: true, value: 640 },
	});
	const control = document.createElement("div");
	control.className = "react-flow__controls";
	const node = document.createElement("div");
	node.className = "react-flow__node";
	element.append(control, node);

	return { element, control, node, prepare: vi.fn(), restore: vi.fn() };
}

describe("high-fidelity diagram export", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		exportMocks.toSvg.mockResolvedValue("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E");
		exportMocks.toBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
		exportMocks.toPng.mockResolvedValue("data:image/png;base64,cG5n");
		exportMocks.outputPdf.mockReturnValue(new Blob(["pdf"], { type: "application/pdf" }));
		Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:diagram") });
		Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("captures the real canvas while excluding editor-only controls", async () => {
		const surface = exportSurface();
		const documentModel = createDiagramDocument("Thesis canvas", diagramNodes, [], []);

		await exportDiagram(documentModel, "svg", surface);

		expect(surface.prepare).toHaveBeenCalledOnce();
		expect(surface.restore).toHaveBeenCalledOnce();
		expect(exportMocks.toSvg).toHaveBeenCalledOnce();
		const options = exportMocks.toSvg.mock.calls[0][1];
		expect(options.width).toBe(960);
		expect(options.height).toBe(640);
		expect(options.filter(surface.control)).toBe(false);
		expect(options.filter(surface.node)).toBe(true);
		expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "image/svg+xml" }));
	});

	it("restores the viewport after PNG and PDF rendering", async () => {
		const documentModel = createDiagramDocument("Thesis canvas", diagramNodes, [], []);
		const pngSurface = exportSurface();
		const pdfSurface = exportSurface();

		await exportDiagram(documentModel, "png", pngSurface);
		await exportDiagram(documentModel, "pdf", pdfSurface);

		expect(exportMocks.toBlob).toHaveBeenCalledOnce();
		expect(exportMocks.toPng).toHaveBeenCalledOnce();
		expect(exportMocks.addImage).toHaveBeenCalledOnce();
		expect(pngSurface.restore).toHaveBeenCalledOnce();
		expect(pdfSurface.restore).toHaveBeenCalledOnce();
	});

	it("restores the viewport when capture fails", async () => {
		const surface = exportSurface();
		exportMocks.toSvg.mockRejectedValueOnce(new Error("capture failed"));

		await expect(
			exportDiagram(createDiagramDocument("Thesis canvas", diagramNodes, [], []), "svg", surface),
		).rejects.toThrow("capture failed");
		expect(surface.restore).toHaveBeenCalledOnce();
	});
});
