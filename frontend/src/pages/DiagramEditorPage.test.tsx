import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { DiagramEditorPage } from "./DiagramEditorPage";

const canvasProbe = vi.hoisted(() => ({
	renderCount: 0,
	selectionHandlers: new Set<unknown>(),
}));

vi.mock("../api/endpoints", () => ({
	diagramApi: {
		get: vi.fn(async () => ({
			id: "diagram-1",
			projectId: "project-1",
			title: "Runtime test",
			role: "viewer",
			snapshotVersion: 1,
			lastUpdateSeq: 0,
		})),
	},
	crdtApi: {
		getSnapshot: vi.fn(async () => new Uint8Array()),
		listUpdates: vi.fn(async () => ({ items: [], snapshotBaseUpdateSeq: 0, lastUpdateSeq: 0 })),
		listSnapshots: vi.fn(async () => []),
		getSnapshotVersion: vi.fn(async () => new Uint8Array()),
		postUpdate: vi.fn(),
		saveSnapshot: vi.fn(),
	},
}));

vi.mock("../hooks/useAuth", () => ({
	useSession: () => ({
		data: {
			user: { id: "user-1", email: "reader@example.com", name: "Reader" },
		},
	}),
}));

vi.mock("../components/editor/DiagramEditorPanel", () => ({
	DiagramEditorPanel: () => null,
}));

vi.mock("../components/editor/DiagramNodes", () => ({
	CommentNode: () => null,
	DiagramBoundaryNode: () => null,
	DiagramComponentNode: () => null,
}));

vi.mock("../components/editor/DiagramCanvas", async () => {
	const React = await import("react");

	return {
		DiagramCanvas: ({
			onSelectionChange,
		}: {
			onSelectionChange: (selection: { nodes: never[]; edges: never[] }) => void;
		}) => {
			canvasProbe.renderCount += 1;
			canvasProbe.selectionHandlers.add(onSelectionChange);
			React.useEffect(() => {
				onSelectionChange({ nodes: [], edges: [] });
			}, [onSelectionChange]);
			return React.createElement("div", { "data-testid": "diagram-canvas" });
		},
	};
});

class IdleWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readyState: number = IdleWebSocket.CONNECTING;
	binaryType: BinaryType = "blob";

	addEventListener() {}
	send() {}
	close() {
		this.readyState = IdleWebSocket.CLOSED;
	}
}

describe("DiagramEditorPage selection integration", () => {
	beforeEach(() => {
		canvasProbe.renderCount = 0;
		canvasProbe.selectionHandlers.clear();
		vi.stubGlobal("WebSocket", IdleWebSocket);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("keeps the React Flow selection callback stable across parent renders", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter
					initialEntries={[
						"/workspaces/workspace-1/projects/project-1/diagrams/diagram-1/editor",
					]}
				>
					<Routes>
						<Route
							path="/workspaces/:workspaceId/projects/:projectId/diagrams/:diagramId/editor"
							element={<DiagramEditorPage />}
						/>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		expect(screen.getByTestId("diagram-canvas")).toBeInTheDocument();
		await waitFor(() => expect(canvasProbe.renderCount).toBeGreaterThan(1));
		expect(canvasProbe.selectionHandlers.size).toBe(1);
	});
});
