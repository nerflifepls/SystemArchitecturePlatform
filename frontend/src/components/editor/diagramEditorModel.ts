import type { Edge, Node, NodeChange } from "@xyflow/react";
import * as Y from "yjs";

import type { CrdtUpdateDto } from "../../api/types";

export type StoredNodeData = {
	label: string;
	kind: string;
};

export type DiagramNodeData = StoredNodeData & {
	text?: string;
	authorName?: string;
	createdAt?: string;
	updatedAt?: string;
	size?: CommentSize;
	shouldFocus?: boolean;
	readOnly?: boolean;
	onDelete?: (commentId: string) => void;
	onFocusHandled?: (commentId: string) => void;
	onResize?: (commentId: string, size: CommentSize) => void;
	onTextChange?: (commentId: string, text: string) => void;
};

export type DiagramNode = Node<DiagramNodeData>;
export type DiagramEdge = Edge;

export const DIAGRAM_EDGE_TYPE = "smoothstep" as const;

export function normalizeHandleId(handleId?: string | null) {
	return handleId?.replace(/-(source|target)$/, "") || undefined;
}

export type StoredNode = {
	id: string;
	type?: string;
	position: { x: number; y: number };
	data: StoredNodeData;
	size?: BoundarySize;
};

export type StoredEdge = {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
	type?: string;
	label?: string;
	animated?: boolean;
};

export type StoredComment = {
	id: string;
	position?: { x: number; y: number };
	size?: CommentSize;
	text: string;
	authorName: string;
	authorUserId?: string;
	createdAt: string;
	updatedAt?: string;
};

export type DiagramSharedMaps = {
	nodes: Y.Map<StoredNode>;
	edges: Y.Map<StoredEdge>;
	comments: Y.Map<StoredComment>;
};

export type SyncState = "loading" | "live" | "saving" | "offline" | "error";

export type FlowPosition = {
	x: number;
	y: number;
};

export type CommentSize = {
	width: number;
	height: number;
};

export type BoundarySize = CommentSize;

export const INIT_ORIGIN = "init";
export const LOCAL_ORIGIN = "local";
export const LIVE_DRAG_ORIGIN = "live-drag";
export const REMOTE_ORIGIN = "remote";
export const NODE_SNAP_DISTANCE = 18;
export const COMMENT_DEFAULT_SIZE = { width: 246, height: 154 };
export const COMMENT_MIN_SIZE = { width: 190, height: 128 };
export const COMMENT_MAX_SIZE = { width: 460, height: 360 };
export const BOUNDARY_DEFAULT_SIZE = { width: 440, height: 280 };
export const BOUNDARY_MIN_SIZE = { width: 260, height: 160 };
export const BOUNDARY_MAX_SIZE = { width: 2400, height: 1600 };
export const INITIAL_UPDATE_COMPACTION_THRESHOLD = 40;
export const NODE_KIND_PRESETS = [
	"component",
	"client",
	"service",
	"database",
	"cache",
	"queue",
	"gateway",
	"worker",
	"external",
] as const;
export const PROTOCOL_PRESETS = [
	"HTTP",
	"HTTPS",
	"REST",
	"RPC",
	"gRPC",
	"GraphQL",
	"WebSocket",
	"TCP",
	"UDP",
	"MQTT",
	"AMQP",
	"Kafka",
	"NATS",
	"SQS",
	"JDBC",
	"ODBC",
	"SSH",
	"SMTP",
] as const;

export function toStoredNode(node: DiagramNode): StoredNode {
	const size =
		node.type === "boundary" ?
			clampBoundarySize({
				width: finiteDimension(node.width ?? node.measured?.width, BOUNDARY_DEFAULT_SIZE.width),
				height: finiteDimension(node.height ?? node.measured?.height, BOUNDARY_DEFAULT_SIZE.height),
			})
		: undefined;

	return {
		id: node.id,
		type: node.type,
		position: { x: node.position.x, y: node.position.y },
		data: {
			label: String(node.data.label || "Node"),
			kind: String(node.data.kind || "component"),
		},
		...(size ? { size } : {}),
	};
}

export function toFlowNode(node: StoredNode): DiagramNode {
	const size = clampBoundarySize(node.size ?? BOUNDARY_DEFAULT_SIZE);

	return {
		id: node.id,
		type: node.type ?? "default",
		position: node.position,
		data: node.data,
		...(node.type === "boundary" ? { width: size.width, height: size.height, zIndex: -1 } : {}),
	};
}

export function toStoredEdge(edge: DiagramEdge): StoredEdge {
	return {
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: normalizeHandleId(edge.sourceHandle),
		targetHandle: normalizeHandleId(edge.targetHandle),
		type: DIAGRAM_EDGE_TYPE,
		label: typeof edge.label === "string" ? edge.label : undefined,
		animated: edge.animated,
	};
}

export function toFlowEdge(edge: StoredEdge): DiagramEdge {
	return {
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: normalizeHandleId(edge.sourceHandle),
		targetHandle: normalizeHandleId(edge.targetHandle),
		type: DIAGRAM_EDGE_TYPE,
		label: edge.label,
		animated: edge.animated,
	};
}

export function sortComments(comments: StoredComment[]) {
	return [...comments].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export function formatCommentTimestamp(value: string) {
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return "Just now";
	}

	return date.toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function isCommentNodeId(nodeId: string) {
	return nodeId.startsWith("comment-");
}

export function getNodeChangeId(change: NodeChange<DiagramNode>) {
	return change.type === "add" ? change.item.id : change.id;
}

export function getFallbackCommentPosition(index: number) {
	return { x: 260 + index * 28, y: 180 + index * 24 };
}

export function clampValue(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

export function clampCommentSize(size: CommentSize) {
	return {
		width: clampValue(size.width, COMMENT_MIN_SIZE.width, COMMENT_MAX_SIZE.width),
		height: clampValue(size.height, COMMENT_MIN_SIZE.height, COMMENT_MAX_SIZE.height),
	};
}

export function clampBoundarySize(size: BoundarySize) {
	return {
		width: clampValue(
			finiteDimension(size.width, BOUNDARY_DEFAULT_SIZE.width),
			BOUNDARY_MIN_SIZE.width,
			BOUNDARY_MAX_SIZE.width,
		),
		height: clampValue(
			finiteDimension(size.height, BOUNDARY_DEFAULT_SIZE.height),
			BOUNDARY_MIN_SIZE.height,
			BOUNDARY_MAX_SIZE.height,
		),
	};
}

function finiteDimension(value: number | undefined, fallback: number) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function positionsEqual(left: FlowPosition | undefined, right: FlowPosition) {
	return Boolean(left && left.x === right.x && left.y === right.y);
}

export function commentSizesEqual(left: CommentSize | undefined, right: CommentSize | undefined) {
	const leftSize = left ?? COMMENT_DEFAULT_SIZE;
	const rightSize = right ?? COMMENT_DEFAULT_SIZE;

	return leftSize.width === rightSize.width && leftSize.height === rightSize.height;
}

export function isNodeInsideBoundary(boundary: DiagramNode, node: DiagramNode) {
	if (boundary.type !== "boundary" || boundary.id === node.id) {
		return false;
	}

	const boundaryWidth = getNodeDimension(boundary, "width", BOUNDARY_DEFAULT_SIZE.width);
	const boundaryHeight = getNodeDimension(boundary, "height", BOUNDARY_DEFAULT_SIZE.height);
	const nodeWidth = getNodeDimension(node, "width", 0);
	const nodeHeight = getNodeDimension(node, "height", 0);
	const nodeCenterX = node.position.x + nodeWidth / 2;
	const nodeCenterY = node.position.y + nodeHeight / 2;

	return (
		nodeCenterX >= boundary.position.x &&
		nodeCenterX <= boundary.position.x + boundaryWidth &&
		nodeCenterY >= boundary.position.y &&
		nodeCenterY <= boundary.position.y + boundaryHeight
	);
}

function getNodeDimension(node: DiagramNode, dimension: "width" | "height", fallback: number) {
	const styleValue = node.style?.[dimension];
	const candidates = [
		node.measured?.[dimension],
		node[dimension],
		node.data.size?.[dimension],
		typeof styleValue === "number" ? styleValue : undefined,
	];

	for (const candidate of candidates) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			return candidate;
		}
	}

	return fallback;
}

export function commentNodeDataMatches(
	data: DiagramNodeData,
	comment: StoredComment,
	size: CommentSize,
	shouldFocus: boolean,
	readOnly: boolean,
) {
	return (
		data.text === comment.text &&
		data.authorName === comment.authorName &&
		data.createdAt === comment.createdAt &&
		data.updatedAt === comment.updatedAt &&
		data.shouldFocus === shouldFocus &&
		data.readOnly === readOnly &&
		commentSizesEqual(data.size, size)
	);
}

export function snapNodePosition(nodeId: string, position: FlowPosition, currentNodes: DiagramNode[]) {
	if (currentNodes.some((node) => node.id === nodeId && node.type === "boundary")) {
		return position;
	}
	let snappedX = position.x;
	let snappedY = position.y;
	let closestXDistance = NODE_SNAP_DISTANCE + 1;
	let closestYDistance = NODE_SNAP_DISTANCE + 1;

	for (const node of currentNodes) {
		if (node.id === nodeId || isCommentNodeId(node.id) || node.type === "boundary") {
			continue;
		}

		const xDistance = Math.abs(node.position.x - position.x);
		const yDistance = Math.abs(node.position.y - position.y);

		if (xDistance <= NODE_SNAP_DISTANCE && xDistance < closestXDistance) {
			snappedX = node.position.x;
			closestXDistance = xDistance;
		}

		if (yDistance <= NODE_SNAP_DISTANCE && yDistance < closestYDistance) {
			snappedY = node.position.y;
			closestYDistance = yDistance;
		}
	}

	return { x: snappedX, y: snappedY };
}

export function expandBoundaryDragChanges(
	changes: NodeChange<DiagramNode>[],
	currentNodes: DiagramNode[],
	dragSessions: Map<string, Set<string>>,
) {
	const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
	const explicitlyPositionedIds = new Set(
		changes.flatMap((change) => {
			if (change.type === "position" || change.type === "remove" || change.type === "replace") {
				return [getNodeChangeId(change)];
			}

			return [];
		}),
	);
	const groupedNodeIds = new Set<string>();
	const groupedChanges: NodeChange<DiagramNode>[] = [];
	for (const change of changes) {
		if (change.type === "remove" && nodesById.get(change.id)?.type === "boundary") {
			dragSessions.delete(change.id);
		}
	}

	for (const change of changes) {
		if (change.type !== "position" || !change.position || typeof change.dragging !== "boolean") {
			continue;
		}

		const boundary = nodesById.get(change.id);
		if (boundary?.type !== "boundary") {
			continue;
		}

		let containedNodeIds = dragSessions.get(boundary.id);
		if (!containedNodeIds) {
			containedNodeIds = new Set(
				currentNodes.filter((node) => isNodeInsideBoundary(boundary, node)).map((node) => node.id),
			);
			dragSessions.set(boundary.id, containedNodeIds);
		}

		const delta = {
			x: change.position.x - boundary.position.x,
			y: change.position.y - boundary.position.y,
		};

		for (const nodeId of containedNodeIds) {
			groupedNodeIds.add(nodeId);
			if (explicitlyPositionedIds.has(nodeId)) {
				continue;
			}

			const node = nodesById.get(nodeId);
			if (!node) {
				continue;
			}

			groupedChanges.push({
				id: nodeId,
				type: "position",
				position: {
					x: node.position.x + delta.x,
					y: node.position.y + delta.y,
				},
				dragging: change.dragging,
			});
		}

		if (change.dragging === false) {
			dragSessions.delete(boundary.id);
		}
	}

	return { changes: [...changes, ...groupedChanges], groupedNodeIds };
}

export function makeDefaultNodes(): StoredNode[] {
	return [
		{
			id: "node-client",
			type: "default",
			position: { x: 80, y: 140 },
			data: { label: "Client app", kind: "client" },
		},
		{
			id: "node-api",
			type: "default",
			position: { x: 360, y: 140 },
			data: { label: "Backend API", kind: "service" },
		},
	];
}

export function makeDefaultEdges(): StoredEdge[] {
	return [
		{
			id: "edge-client-api",
			source: "node-client",
			target: "node-api",
			sourceHandle: "right",
			targetHandle: "left",
			type: DIAGRAM_EDGE_TYPE,
			label: "HTTPS",
		},
	];
}

export function decodeBase64(value: string) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

export function updateDtoToBytes(update: CrdtUpdateDto) {
	return decodeBase64(update.updateBase64);
}

export function toArrayBuffer(bytes: Uint8Array) {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

export function encodeCompactedSnapshot(sourceMaps: DiagramSharedMaps) {
	const compactedDoc = new Y.Doc();
	const compactedNodes = compactedDoc.getMap<StoredNode>("nodes");
	const compactedEdges = compactedDoc.getMap<StoredEdge>("edges");
	const compactedComments = compactedDoc.getMap<StoredComment>("comments");
	compactedDoc.getMap("docs");

	compactedDoc.transact(() => {
		sourceMaps.nodes.forEach((node, nodeId) => compactedNodes.set(nodeId, node));
		sourceMaps.edges.forEach((edge, edgeId) => compactedEdges.set(edgeId, edge));
		sourceMaps.comments.forEach((comment, commentId) => compactedComments.set(commentId, comment));
	}, INIT_ORIGIN);

	const snapshot = Y.encodeStateAsUpdate(compactedDoc);
	compactedDoc.destroy();
	return snapshot;
}
