import { describe, expect, it } from "vitest";

import type { DiagramEdge, DiagramNode } from "./diagramEditorModel";
import { analyzeArchitecture } from "./architectureInsights";

function node(id: string, kind: string): DiagramNode {
	return { id, type: "default", position: { x: 0, y: 0 }, data: { label: id, kind } };
}

function edge(id: string, source: string, target: string, label = "HTTPS"): DiagramEdge {
	return { id, source, target, label };
}

describe("architecture insights", () => {
	it("gives a clean client-to-service graph a full score", () => {
		const result = analyzeArchitecture([node("client", "client"), node("api", "service")], [edge("e1", "client", "api")]);
		expect(result.score).toBe(100);
		expect(result.insights).toEqual([]);
	});

	it("finds direct database access and an insecure boundary protocol", () => {
		const result = analyzeArchitecture(
			[node("client", "client"), node("db", "database")],
			[edge("e1", "client", "db", "HTTP")],
		);
		expect(result.insights.map((insight) => insight.id)).toEqual(
			expect.arrayContaining(["client-database-coupling", "unencrypted-boundary"]),
		);
		expect(result.criticalCount).toBe(2);
	});

	it("targets only client-to-database connections when clients are also connected to each other", () => {
		const result = analyzeArchitecture(
			[node("client-a", "client"), node("client-b", "client"), node("db", "database")],
			[
				edge("client-to-client", "client-a", "client-b"),
				edge("client-a-to-db", "client-a", "db"),
				edge("db-to-client-b", "db", "client-b"),
			],
		);
		const insight = result.insights.find((item) => item.id === "client-database-coupling");

		expect(insight?.edgeIds).toEqual(["client-a-to-db", "db-to-client-b"]);
		expect(insight?.edgeIds).not.toContain("client-to-client");
		expect(insight?.nodeIds).toEqual(["client-a", "db", "client-b"]);
	});

	it("detects strongly connected dependency cycles", () => {
		const result = analyzeArchitecture(
			[node("a", "service"), node("b", "service"), node("c", "worker")],
			[edge("ab", "a", "b"), edge("bc", "b", "c"), edge("ca", "c", "a")],
		);
		expect(result.insights.some((insight) => insight.id.startsWith("cycle-"))).toBe(true);
	});

	it("groups disconnected nodes and unlabeled edges into actionable findings", () => {
		const result = analyzeArchitecture(
			[node("a", "service"), node("b", "service"), node("orphan", "cache")],
			[edge("e1", "a", "b", "")],
		);
		expect(result.insights.find((insight) => insight.id === "orphan-nodes")?.nodeIds).toEqual(["orphan"]);
		expect(result.insights.find((insight) => insight.id === "unlabeled-edges")?.edgeIds).toEqual(["e1"]);
	});
});
