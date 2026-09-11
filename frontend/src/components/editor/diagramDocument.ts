import {
	toStoredEdge,
	toStoredNode,
	type DiagramEdge,
	type DiagramNode,
	type StoredComment,
	type StoredEdge,
	type StoredNode,
} from "./diagramEditorModel";

export type DiagramDocument = {
	schemaVersion: 1;
	exportedAt: string;
	generator: "System Design Workspace";
	diagram: {
		title: string;
		nodes: StoredNode[];
		edges: StoredEdge[];
		comments: StoredComment[];
	};
};

type ExportFormat = "json" | "svg" | "png" | "pdf";

type Bounds = {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	width: number;
	height: number;
};

const DEFAULT_NODE_WIDTH = 190;
const DEFAULT_NODE_HEIGHT = 78;
const BOUNDARY_WIDTH = 440;
const BOUNDARY_HEIGHT = 280;
const EXPORT_PADDING = 70;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeText(value: unknown, fallback = "") {
	return typeof value === "string" ? value : fallback;
}

function sanitizeFilename(value: string) {
	return (value.trim() || "diagram").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").toLowerCase();
}

function escapeXml(value: string) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nodeDimensions(node: StoredNode) {
	return node.type === "boundary" ? { width: BOUNDARY_WIDTH, height: BOUNDARY_HEIGHT } : { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

function diagramBounds(nodes: StoredNode[], comments: StoredComment[]): Bounds {
	const boxes = [
		...nodes.map((node) => ({ ...node.position, ...nodeDimensions(node) })),
		...comments.map((comment) => ({
			x: comment.position?.x ?? 0,
			y: comment.position?.y ?? 0,
			width: comment.size?.width ?? 246,
			height: comment.size?.height ?? 154,
		})),
	];

	if (!boxes.length) {
		return { minX: 0, minY: 0, maxX: 800, maxY: 500, width: 800, height: 500 };
	}

	const minX = Math.min(...boxes.map((box) => box.x)) - EXPORT_PADDING;
	const minY = Math.min(...boxes.map((box) => box.y)) - EXPORT_PADDING;
	const maxX = Math.max(...boxes.map((box) => box.x + box.width)) + EXPORT_PADDING;
	const maxY = Math.max(...boxes.map((box) => box.y + box.height)) + EXPORT_PADDING;
	return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function handlePoint(node: StoredNode, handle: string | undefined, isSource: boolean) {
	const { width, height } = nodeDimensions(node);
	const side = handle ?? (isSource ? "right" : "left");
	switch (side) {
		case "top":
			return { x: node.position.x + width / 2, y: node.position.y, side };
		case "bottom":
			return { x: node.position.x + width / 2, y: node.position.y + height, side };
		case "left":
			return { x: node.position.x, y: node.position.y + height / 2, side };
		default:
			return { x: node.position.x + width, y: node.position.y + height / 2, side: "right" };
	}
}

function orthogonalPath(source: ReturnType<typeof handlePoint>, target: ReturnType<typeof handlePoint>) {
	if (["top", "bottom"].includes(source.side) || ["top", "bottom"].includes(target.side)) {
		const middleY = (source.y + target.y) / 2;
		return `M ${source.x} ${source.y} V ${middleY} H ${target.x} V ${target.y}`;
	}
	const middleX = (source.x + target.x) / 2;
	return `M ${source.x} ${source.y} H ${middleX} V ${target.y} H ${target.x}`;
}

function downloadBlob(filename: string, blob: Blob) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createDiagramDocument(
	title: string,
	nodes: DiagramNode[],
	edges: DiagramEdge[],
	comments: StoredComment[],
): DiagramDocument {
	return {
		schemaVersion: 1,
		exportedAt: new Date().toISOString(),
		generator: "System Design Workspace",
		diagram: {
			title: title.trim() || "Untitled diagram",
			nodes: nodes.filter((node) => node.type !== "comment").map(toStoredNode),
			edges: edges.map(toStoredEdge),
			comments,
		},
	};
}

export function parseDiagramDocument(value: string): DiagramDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("The selected file is not valid JSON.");
	}
	if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.diagram)) {
		throw new Error("This is not a supported diagram export.");
	}
	const diagram = parsed.diagram;
	if (!Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges) || !Array.isArray(diagram.comments)) {
		throw new Error("The diagram export is missing nodes, edges, or comments.");
	}

	const nodes: StoredNode[] = diagram.nodes.map((value, index) => {
		if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.data)) {
			throw new Error(`Node ${index + 1} has an invalid structure.`);
		}
		const x = Number(value.position.x);
		const y = Number(value.position.y);
		if (!safeText(value.id).trim() || !Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error(`Node ${index + 1} has an invalid id or position.`);
		}
		return {
			id: safeText(value.id),
			type: value.type === "boundary" ? "boundary" : "default",
			position: { x, y },
			data: {
				label: safeText(value.data.label, "Node"),
				kind: safeText(value.data.kind, "component"),
			},
		};
	});
	const nodeIds = new Set(nodes.map((node) => node.id));
	if (nodeIds.size !== nodes.length) {
		throw new Error("The diagram contains duplicate node ids.");
	}

	const edges: StoredEdge[] = diagram.edges.map((value, index) => {
		if (!isRecord(value)) {
			throw new Error(`Connection ${index + 1} has an invalid structure.`);
		}
		const id = safeText(value.id);
		const source = safeText(value.source);
		const target = safeText(value.target);
		if (!id || !nodeIds.has(source) || !nodeIds.has(target)) {
			throw new Error(`Connection ${index + 1} references a missing node.`);
		}
		return {
			id,
			source,
			target,
			sourceHandle: safeText(value.sourceHandle) || undefined,
			targetHandle: safeText(value.targetHandle) || undefined,
			type: "smoothstep",
			label: safeText(value.label) || undefined,
			animated: value.animated === true,
		};
	});
	if (new Set(edges.map((edge) => edge.id)).size !== edges.length) {
		throw new Error("The diagram contains duplicate connection ids.");
	}

	const comments: StoredComment[] = diagram.comments.map((value, index) => {
		if (!isRecord(value) || !safeText(value.id).startsWith("comment-") || !safeText(value.createdAt)) {
			throw new Error(`Comment ${index + 1} has an invalid structure.`);
		}
		const position = isRecord(value.position) ? { x: Number(value.position.x), y: Number(value.position.y) } : undefined;
		const size = isRecord(value.size) ? { width: Number(value.size.width), height: Number(value.size.height) } : undefined;
		return {
			id: safeText(value.id),
			position: position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : undefined,
			size: size && Number.isFinite(size.width) && Number.isFinite(size.height) ? size : undefined,
			text: safeText(value.text),
			authorName: safeText(value.authorName, "Imported note"),
			authorUserId: safeText(value.authorUserId) || undefined,
			createdAt: safeText(value.createdAt),
			updatedAt: safeText(value.updatedAt) || undefined,
		};
	});

	return {
		schemaVersion: 1,
		exportedAt: safeText(parsed.exportedAt, new Date().toISOString()),
		generator: "System Design Workspace",
		diagram: { title: safeText(diagram.title, "Imported diagram"), nodes, edges, comments },
	};
}

export function renderDiagramSvg(documentModel: DiagramDocument) {
	const { nodes, edges, comments, title } = documentModel.diagram;
	const bounds = diagramBounds(nodes, comments);
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const boundaryMarkup = nodes
		.filter((node) => node.type === "boundary")
		.map((node) => {
			const { width, height } = nodeDimensions(node);
			return `<g><rect x="${node.position.x}" y="${node.position.y}" width="${width}" height="${height}" rx="18" fill="#102128" fill-opacity=".42" stroke="#3d8d66" stroke-width="2" stroke-dasharray="9 7"/><text x="${node.position.x + 18}" y="${node.position.y + 30}" fill="#9eb8c7" font-size="14" font-weight="700" letter-spacing="1">${escapeXml(node.data.label.toUpperCase())}</text></g>`;
		})
		.join("");
	const edgeMarkup = edges
		.map((edge) => {
			const sourceNode = nodeById.get(edge.source);
			const targetNode = nodeById.get(edge.target);
			if (!sourceNode || !targetNode || sourceNode.type === "boundary" || targetNode.type === "boundary") {
				return "";
			}
			const source = handlePoint(sourceNode, edge.sourceHandle, true);
			const target = handlePoint(targetNode, edge.targetHandle, false);
			const labelX = (source.x + target.x) / 2;
			const labelY = (source.y + target.y) / 2 - 7;
			return `<g><path d="${orthogonalPath(source, target)}" fill="none" stroke="#62d891" stroke-width="3" marker-end="url(#arrow)"/>${edge.label ? `<rect x="${labelX - 31}" y="${labelY - 13}" width="62" height="20" rx="5" fill="#0d1a21"/><text x="${labelX}" y="${labelY + 1}" fill="#edf9f1" font-size="11" font-weight="700" text-anchor="middle">${escapeXml(String(edge.label).slice(0, 18))}</text>` : ""}</g>`;
		})
		.join("");
	const nodeMarkup = nodes
		.filter((node) => node.type !== "boundary")
		.map((node) => {
			const { width, height } = nodeDimensions(node);
			return `<g><rect x="${node.position.x}" y="${node.position.y}" width="${width}" height="${height}" rx="12" fill="#142630" stroke="#49bc7a" stroke-width="2"/><text x="${node.position.x + width / 2}" y="${node.position.y + 28}" fill="#9eb8c7" font-size="11" font-weight="700" text-anchor="middle" letter-spacing="1">${escapeXml(node.data.kind.toUpperCase())}</text><text x="${node.position.x + width / 2}" y="${node.position.y + 53}" fill="#f3faf5" font-size="16" font-weight="700" text-anchor="middle">${escapeXml(node.data.label.slice(0, 26))}</text></g>`;
		})
		.join("");
	const commentMarkup = comments
		.map((comment) => {
			const x = comment.position?.x ?? 0;
			const y = comment.position?.y ?? 0;
			const width = comment.size?.width ?? 246;
			const height = comment.size?.height ?? 154;
			return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" fill="#203039" stroke="#6a957d" stroke-width="1"/><text x="${x + 14}" y="${y + 24}" fill="#9eb8c7" font-size="11" font-weight="700">NOTE · ${escapeXml(comment.authorName.slice(0, 24))}</text><text x="${x + 14}" y="${y + 50}" fill="#edf9f1" font-size="13">${escapeXml(comment.text.replace(/\s+/g, " ").slice(0, 34))}</text></g>`;
		})
		.join("");

	return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#62d891"/></marker><pattern id="grid" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#809b96" fill-opacity=".42"/></pattern></defs><rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="#091419"/><rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="url(#grid)"/><text x="${bounds.minX + 24}" y="${bounds.minY + 36}" fill="#edf9f1" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="700">${escapeXml(title)}</text><g font-family="Inter,Arial,sans-serif">${boundaryMarkup}${edgeMarkup}${nodeMarkup}${commentMarkup}</g></svg>`;
}

function pdfSafe(value: string) {
	return value.normalize("NFKD").replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}

export function renderDiagramPdf(documentModel: DiagramDocument) {
	const pageWidth = 842;
	const pageHeight = 595;
	const bounds = diagramBounds(documentModel.diagram.nodes, documentModel.diagram.comments);
	const scale = Math.min((pageWidth - 70) / Math.max(bounds.width, 1), (pageHeight - 90) / Math.max(bounds.height, 1), 1.35);
	const tx = (x: number) => 35 + (x - bounds.minX) * scale;
	const ty = (y: number) => pageHeight - 48 - (y - bounds.minY) * scale;
	const commands: string[] = [
		"0.035 0.075 0.095 rg 0 0 842 595 re f",
		`BT /F1 17 Tf 0.93 0.98 0.95 rg 35 565 Td (${pdfSafe(documentModel.diagram.title)}) Tj ET`,
	];
	const nodeById = new Map(documentModel.diagram.nodes.map((node) => [node.id, node]));

	for (const edge of documentModel.diagram.edges) {
		const sourceNode = nodeById.get(edge.source);
		const targetNode = nodeById.get(edge.target);
		if (!sourceNode || !targetNode || sourceNode.type === "boundary" || targetNode.type === "boundary") continue;
		const source = handlePoint(sourceNode, edge.sourceHandle, true);
		const target = handlePoint(targetNode, edge.targetHandle, false);
		const middleX = (tx(source.x) + tx(target.x)) / 2;
		commands.push(`0.38 0.84 0.57 RG 2 w ${tx(source.x).toFixed(2)} ${ty(source.y).toFixed(2)} m ${middleX.toFixed(2)} ${ty(source.y).toFixed(2)} l ${middleX.toFixed(2)} ${ty(target.y).toFixed(2)} l ${tx(target.x).toFixed(2)} ${ty(target.y).toFixed(2)} l S`);
		if (edge.label) {
			commands.push(`BT /F1 8 Tf 0.93 0.98 0.95 rg ${middleX.toFixed(2)} ${(ty((source.y + target.y) / 2) + 4).toFixed(2)} Td (${pdfSafe(String(edge.label).slice(0, 20))}) Tj ET`);
		}
	}

	for (const node of documentModel.diagram.nodes) {
		const size = nodeDimensions(node);
		const x = tx(node.position.x);
		const y = ty(node.position.y + size.height);
		const width = size.width * scale;
		const height = size.height * scale;
		if (node.type === "boundary") {
			commands.push(`0.24 0.55 0.40 RG 1.2 w [5 4] 0 d ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S [] 0 d`);
		} else {
			commands.push(`0.075 0.14 0.17 rg 0.29 0.74 0.48 RG 1.5 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re B`);
		}
		commands.push(`BT /F1 8 Tf 0.62 0.72 0.78 rg ${(x + 9).toFixed(2)} ${(y + height - 15).toFixed(2)} Td (${pdfSafe(node.data.kind.toUpperCase())}) Tj ET`);
		commands.push(`BT /F1 11 Tf 0.95 0.98 0.96 rg ${(x + 9).toFixed(2)} ${(y + Math.max(14, height / 2 - 6)).toFixed(2)} Td (${pdfSafe(node.data.label.slice(0, 32))}) Tj ET`);
	}
	for (const comment of documentModel.diagram.comments) {
		const width = (comment.size?.width ?? 246) * scale;
		const height = (comment.size?.height ?? 154) * scale;
		const x = tx(comment.position?.x ?? 0);
		const y = ty((comment.position?.y ?? 0) + (comment.size?.height ?? 154));
		commands.push(`0.10 0.17 0.20 rg 0.42 0.58 0.49 RG 1 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re B`);
		commands.push(`BT /F1 8 Tf 0.62 0.72 0.78 rg ${(x + 9).toFixed(2)} ${(y + height - 15).toFixed(2)} Td (NOTE - ${pdfSafe(comment.authorName.slice(0, 22))}) Tj ET`);
		commands.push(`BT /F1 9 Tf 0.95 0.98 0.96 rg ${(x + 9).toFixed(2)} ${(y + height - 32).toFixed(2)} Td (${pdfSafe(comment.text.replace(/\s+/g, " ").slice(0, 46))}) Tj ET`);
	}

	const stream = commands.join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	objects.forEach((object, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xrefOffset = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) {
		pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
	return new TextEncoder().encode(pdf);
}

async function svgToPng(svg: string) {
	const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.decoding = "async";
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Could not render the diagram image."));
			image.src = url;
		});
		const canvas = document.createElement("canvas");
		const scale = Math.min(2, 4096 / Math.max(image.width, image.height, 1));
		canvas.width = Math.max(1, Math.round(image.width * scale));
		canvas.height = Math.max(1, Math.round(image.height * scale));
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas export is unavailable in this browser.");
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Could not encode the PNG."))), "image/png"),
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function exportDiagram(documentModel: DiagramDocument, format: ExportFormat) {
	const baseName = sanitizeFilename(documentModel.diagram.title);
	if (format === "json") {
		downloadBlob(`${baseName}.system-design.json`, new Blob([JSON.stringify(documentModel, null, 2)], { type: "application/json" }));
		return;
	}
	const svg = renderDiagramSvg(documentModel);
	if (format === "svg") {
		downloadBlob(`${baseName}.svg`, new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
		return;
	}
	if (format === "png") {
		downloadBlob(`${baseName}.png`, await svgToPng(svg));
		return;
	}
	downloadBlob(`${baseName}.pdf`, new Blob([renderDiagramPdf(documentModel)], { type: "application/pdf" }));
}
