import type { DiagramEdge, DiagramNode } from "./diagramEditorModel";

export type LayoutDirection = "horizontal" | "vertical";
export type AlignmentAxis = "horizontal" | "vertical";

export function alignDiagramNodes(nodes: DiagramNode[], selectedIds: Set<string>, axis: AlignmentAxis) {
	const selected = nodes.filter((node) => selectedIds.has(node.id) && node.type !== "comment" && node.type !== "boundary");
	if (selected.length < 2) {
		return nodes;
	}
	const coordinate = axis === "horizontal" ? "y" : "x";
	const value = selected.reduce((total, node) => total + node.position[coordinate], 0) / selected.length;
	const alignedValue = Math.round(value);
	let changed = false;
	const alignedNodes = nodes.map((node) => {
		if (
			!selectedIds.has(node.id) ||
			node.type === "comment" ||
			node.type === "boundary" ||
			node.position[coordinate] === alignedValue
		) {
			return node;
		}

		changed = true;
		return { ...node, position: { ...node.position, [coordinate]: alignedValue } };
	});

	return changed ? alignedNodes : nodes;
}

export function autoLayoutDiagram(nodes: DiagramNode[], edges: DiagramEdge[], direction: LayoutDirection = "horizontal") {
	const layoutNodes = nodes.filter((node) => node.type !== "comment" && node.type !== "boundary");
	const layoutIds = new Set(layoutNodes.map((node) => node.id));
	const indegree = new Map(layoutNodes.map((node) => [node.id, 0]));
	const adjacency = new Map(layoutNodes.map((node) => [node.id, [] as string[]]));

	for (const edge of edges) {
		if (!layoutIds.has(edge.source) || !layoutIds.has(edge.target) || edge.source === edge.target) {
			continue;
		}
		adjacency.get(edge.source)?.push(edge.target);
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
	}

	const rank = new Map(layoutNodes.map((node) => [node.id, 0]));
	const queue = layoutNodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
	const visited = new Set<string>();

	while (queue.length) {
		const nodeId = queue.shift() as string;
		visited.add(nodeId);
		for (const targetId of adjacency.get(nodeId) ?? []) {
			rank.set(targetId, Math.max(rank.get(targetId) ?? 0, (rank.get(nodeId) ?? 0) + 1));
			const nextDegree = (indegree.get(targetId) ?? 1) - 1;
			indegree.set(targetId, nextDegree);
			if (nextDegree === 0) {
				queue.push(targetId);
			}
		}
	}

	let fallbackRank = Math.max(0, ...rank.values());
	for (const node of layoutNodes) {
		if (!visited.has(node.id)) {
			fallbackRank += 1;
			rank.set(node.id, fallbackRank);
		}
	}

	const lanes = new Map<number, DiagramNode[]>();
	for (const node of layoutNodes) {
		const nodeRank = rank.get(node.id) ?? 0;
		lanes.set(nodeRank, [...(lanes.get(nodeRank) ?? []), node]);
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const [nodeRank, lane] of [...lanes.entries()].sort(([left], [right]) => left - right)) {
		lane.sort((left, right) => left.position.y - right.position.y || left.id.localeCompare(right.id));
		lane.forEach((node, laneIndex) => {
			positions.set(
				node.id,
				direction === "horizontal" ?
					{ x: 100 + nodeRank * 300, y: 100 + laneIndex * 160 }
				: { x: 100 + laneIndex * 250, y: 100 + nodeRank * 170 },
			);
		});
	}

	return nodes.map((node) => {
		const position = positions.get(node.id);
		return position ? { ...node, position } : node;
	});
}
