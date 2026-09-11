import type { DiagramEdge, DiagramNode } from "./diagramEditorModel";

export type InsightSeverity = "critical" | "warning" | "info";

export type ArchitectureInsight = {
	id: string;
	severity: InsightSeverity;
	title: string;
	description: string;
	recommendation: string;
	nodeIds: string[];
	edgeIds: string[];
};

export type ArchitectureAssessment = {
	score: number;
	criticalCount: number;
	warningCount: number;
	infoCount: number;
	insights: ArchitectureInsight[];
};

const severityWeight: Record<InsightSeverity, number> = {
	critical: 18,
	warning: 8,
	info: 2,
};

function nodeKind(node: DiagramNode | undefined) {
	return String(node?.data.kind ?? "").toLowerCase();
}

function findCycles(nodes: DiagramNode[], edges: DiagramEdge[]) {
	const nodeIds = new Set(nodes.map((node) => node.id));
	const adjacency = new Map<string, string[]>();

	for (const node of nodes) {
		adjacency.set(node.id, []);
	}
	for (const edge of edges) {
		if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target) {
			adjacency.get(edge.source)?.push(edge.target);
		}
	}

	let index = 0;
	const indexes = new Map<string, number>();
	const lowLinks = new Map<string, number>();
	const stack: string[] = [];
	const inStack = new Set<string>();
	const cycles: string[][] = [];

	function visit(nodeId: string) {
		indexes.set(nodeId, index);
		lowLinks.set(nodeId, index);
		index += 1;
		stack.push(nodeId);
		inStack.add(nodeId);

		for (const targetId of adjacency.get(nodeId) ?? []) {
			if (!indexes.has(targetId)) {
				visit(targetId);
				lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, lowLinks.get(targetId) ?? 0));
			} else if (inStack.has(targetId)) {
				lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId) ?? 0, indexes.get(targetId) ?? 0));
			}
		}

		if (lowLinks.get(nodeId) !== indexes.get(nodeId)) {
			return;
		}

		const component: string[] = [];
		let member = "";
		do {
			member = stack.pop() ?? "";
			if (member) {
				inStack.delete(member);
				component.push(member);
			}
		} while (member && member !== nodeId);

		if (component.length > 1) {
			cycles.push(component.sort());
		}
	}

	for (const node of nodes) {
		if (!indexes.has(node.id)) {
			visit(node.id);
		}
	}

	return cycles;
}

export function analyzeArchitecture(nodes: DiagramNode[], edges: DiagramEdge[]): ArchitectureAssessment {
	const architectureNodes = nodes.filter((node) => node.type !== "boundary" && node.type !== "comment");
	const nodeById = new Map(architectureNodes.map((node) => [node.id, node]));
	const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
	const insights: ArchitectureInsight[] = [];

	const orphanIds = architectureNodes.filter((node) => !connectedIds.has(node.id)).map((node) => node.id);
	if (orphanIds.length) {
		insights.push({
			id: "orphan-nodes",
			severity: "warning",
			title: `${orphanIds.length} disconnected component${orphanIds.length === 1 ? "" : "s"}`,
			description: "Disconnected nodes make the system boundary and runtime flow ambiguous.",
			recommendation: "Connect each component or place it in a clearly labelled future/external boundary.",
			nodeIds: orphanIds,
			edgeIds: [],
		});
	}

	const unlabeledEdgeIds = edges.filter((edge) => !String(edge.label ?? "").trim()).map((edge) => edge.id);
	if (unlabeledEdgeIds.length) {
		insights.push({
			id: "unlabeled-edges",
			severity: "warning",
			title: `${unlabeledEdgeIds.length} unlabeled connection${unlabeledEdgeIds.length === 1 ? "" : "s"}`,
			description: "A connection without a protocol or interaction name cannot be evaluated precisely.",
			recommendation: "Add a protocol, event, query, or command label to every connection.",
			nodeIds: [],
			edgeIds: unlabeledEdgeIds,
		});
	}

	const clientDatabaseEdges = edges.filter((edge) => {
		const sourceKind = nodeKind(nodeById.get(edge.source));
		const targetKind = nodeKind(nodeById.get(edge.target));
		return (sourceKind === "client" && targetKind === "database") || (sourceKind === "database" && targetKind === "client");
	});
	if (clientDatabaseEdges.length) {
		insights.push({
			id: "client-database-coupling",
			severity: "critical",
			title: "Client connects directly to a database",
			description: "Direct database access couples the client to storage and expands the security boundary.",
			recommendation: "Route access through a service or API that owns authorization, validation, and schema changes.",
			nodeIds: [...new Set(clientDatabaseEdges.flatMap((edge) => [edge.source, edge.target]))],
			edgeIds: clientDatabaseEdges.map((edge) => edge.id),
		});
	}

	const selfLoops = edges.filter((edge) => edge.source === edge.target);
	if (selfLoops.length) {
		insights.push({
			id: "self-loops",
			severity: "warning",
			title: `${selfLoops.length} self-referencing connection${selfLoops.length === 1 ? "" : "s"}`,
			description: "Self-loops are often accidental or hide an internal responsibility.",
			recommendation: "Explain the loop in a note or split the internal responsibility into a separate component.",
			nodeIds: [...new Set(selfLoops.map((edge) => edge.source))],
			edgeIds: selfLoops.map((edge) => edge.id),
		});
	}

	for (const cycle of findCycles(architectureNodes, edges)) {
		const cycleSet = new Set(cycle);
		insights.push({
			id: `cycle-${cycle.join("-")}`,
			severity: "warning",
			title: `Circular dependency across ${cycle.length} components`,
			description: "A strongly connected dependency chain can complicate deployment, failure isolation, and testing.",
			recommendation: "Introduce a stable interface, event boundary, or dependency inversion to break the cycle.",
			nodeIds: cycle,
			edgeIds: edges.filter((edge) => cycleSet.has(edge.source) && cycleSet.has(edge.target)).map((edge) => edge.id),
		});
	}

	for (const node of architectureNodes) {
		const outgoing = edges.filter((edge) => edge.source === node.id);
		if (outgoing.length >= 5) {
			insights.push({
				id: `fan-out-${node.id}`,
				severity: "warning",
				title: `High fan-out from ${node.data.label}`,
				description: `${outgoing.length} outgoing dependencies increase coordination and failure propagation risk.`,
				recommendation: "Consider an event bus, orchestration boundary, façade, or responsibility split.",
				nodeIds: [node.id, ...outgoing.map((edge) => edge.target)],
				edgeIds: outgoing.map((edge) => edge.id),
			});
		}
	}

	const duplicated = new Map<string, DiagramEdge[]>();
	for (const edge of edges) {
		const key = `${edge.source}|${edge.target}|${String(edge.label ?? "").trim().toLowerCase()}`;
		duplicated.set(key, [...(duplicated.get(key) ?? []), edge]);
	}
	const duplicateEdges = [...duplicated.values()].filter((items) => items.length > 1).flat();
	if (duplicateEdges.length) {
		insights.push({
			id: "duplicate-connections",
			severity: "info",
			title: "Potential duplicate connections",
			description: "Multiple equivalent arrows can make a diagram look denser without adding meaning.",
			recommendation: "Merge duplicates or give each interaction a distinct semantic label.",
			nodeIds: [...new Set(duplicateEdges.flatMap((edge) => [edge.source, edge.target]))],
			edgeIds: duplicateEdges.map((edge) => edge.id),
		});
	}

	const insecureEdges = edges.filter((edge) => {
		const protocol = String(edge.label ?? "").trim().toUpperCase();
		const endpointKinds = [nodeKind(nodeById.get(edge.source)), nodeKind(nodeById.get(edge.target))];
		return (protocol === "HTTP" || protocol === "TCP") && endpointKinds.some((kind) => kind === "client" || kind === "external");
	});
	if (insecureEdges.length) {
		insights.push({
			id: "unencrypted-boundary",
			severity: "critical",
			title: "Potentially unencrypted trust-boundary traffic",
			description: "HTTP or raw TCP at a client/external boundary may expose credentials or application data.",
			recommendation: "Document transport security explicitly, for example HTTPS or TLS-wrapped TCP.",
			nodeIds: [...new Set(insecureEdges.flatMap((edge) => [edge.source, edge.target]))],
			edgeIds: insecureEdges.map((edge) => edge.id),
		});
	}

	const dataNodes = architectureNodes.filter((node) => ["database", "queue", "cache"].includes(nodeKind(node)));
	for (const node of dataNodes) {
		const consumers = edges.filter((edge) => edge.target === node.id || edge.source === node.id);
		const peers = dataNodes.filter((candidate) => candidate.id !== node.id && nodeKind(candidate) === nodeKind(node));
		if (architectureNodes.length >= 4 && consumers.length >= 2 && peers.length === 0) {
			insights.push({
				id: `spof-${node.id}`,
				severity: "warning",
				title: `${node.data.label} may be a single point of failure`,
				description: "Several components depend on one stateful resource and no redundant peer is shown.",
				recommendation: "Show replication/failover or document why a single instance is acceptable.",
				nodeIds: [node.id, ...consumers.flatMap((edge) => [edge.source, edge.target]).filter((id) => id !== node.id)],
				edgeIds: consumers.map((edge) => edge.id),
			});
		}
	}

	const score = Math.max(0, 100 - insights.reduce((total, insight) => total + severityWeight[insight.severity], 0));
	return {
		score,
		criticalCount: insights.filter((insight) => insight.severity === "critical").length,
		warningCount: insights.filter((insight) => insight.severity === "warning").length,
		infoCount: insights.filter((insight) => insight.severity === "info").length,
		insights,
	};
}
