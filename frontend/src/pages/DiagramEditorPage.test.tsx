import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NodeChange } from "@xyflow/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as Y from "yjs";

import { crdtApi, diagramApi } from "../api/endpoints";
import type { DiagramNode, StoredNode } from "../components/editor/diagramEditorModel";
import { DiagramEditorPage } from "./DiagramEditorPage";

const canvasProbe = vi.hoisted(() => ({
	renderCount: 0,
	selectionHandlers: new Set<unknown>(),
	latestNodes: [] as Array<{ id: string; type?: string; width?: number; height?: number }>,
	onNodesChange: undefined as undefined | ((changes: NodeChange<DiagramNode>[]) => void),
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
			nodes,
			onNodesChange,
			onSelectionChange,
		}: {
			nodes: Array<{ id: string; type?: string; width?: number; height?: number }>;
			onNodesChange: (changes: NodeChange<DiagramNode>[]) => void;
			onSelectionChange: (selection: { nodes: never[]; edges: never[] }) => void;
		}) => {
			canvasProbe.renderCount += 1;
			canvasProbe.selectionHandlers.add(onSelectionChange);
			canvasProbe.latestNodes = nodes;
			canvasProbe.onNodesChange = onNodesChange;
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

describe("DiagramEditorPage integration", () => {
	beforeEach(() => {
		canvasProbe.renderCount = 0;
		canvasProbe.selectionHandlers.clear();
		canvasProbe.latestNodes = [];
		canvasProbe.onNodesChange = undefined;
		localStorage.clear();
		vi.clearAllMocks();
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

	it("persists the complete boundary resize as one durable Yjs update", async () => {
		const initialDoc = new Y.Doc();
		initialDoc.getMap<StoredNode>("nodes").set("boundary", {
			id: "boundary",
			type: "boundary",
			position: { x: 40, y: 60 },
			data: { label: "System boundary", kind: "boundary" },
			size: { width: 440, height: 280 },
		});
		const initialSnapshot = Y.encodeStateAsUpdate(initialDoc);
		initialDoc.destroy();

		vi.mocked(diagramApi.get).mockResolvedValueOnce({
			id: "diagram-1",
			projectId: "project-1",
			title: "Resizable boundary",
			role: "editor",
			snapshotVersion: 1,
			lastUpdateSeq: 0,
		});
		vi.mocked(crdtApi.getSnapshot).mockResolvedValueOnce(initialSnapshot);
		vi.mocked(crdtApi.postUpdate).mockResolvedValue({
			seq: 1,
			updateId: "update-1",
			acceptedAt: new Date().toISOString(),
		});
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

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

		await waitFor(() =>
			expect(canvasProbe.latestNodes.some((node) => node.id === "boundary")).toBe(true),
		);
		const onNodesChange = canvasProbe.onNodesChange;
		expect(onNodesChange).toBeDefined();

		act(() => {
			onNodesChange?.([
				{
					id: "boundary",
					type: "dimensions",
					dimensions: { width: 640, height: 420 },
					resizing: true,
					setAttributes: true,
				},
			]);
			onNodesChange?.([
				{
					id: "boundary",
					type: "dimensions",
					dimensions: { width: 700, height: 460 },
					resizing: true,
					setAttributes: true,
				},
			]);
			onNodesChange?.([
				{
					id: "boundary",
					type: "dimensions",
					dimensions: { width: 700, height: 460 },
					resizing: false,
				},
			]);
		});

		await waitFor(() => expect(crdtApi.postUpdate).toHaveBeenCalledTimes(1));
		const durableUpdate = vi.mocked(crdtApi.postUpdate).mock.calls[0][1];
		const restoredDoc = new Y.Doc();
		Y.applyUpdate(restoredDoc, initialSnapshot);
		Y.applyUpdate(restoredDoc, durableUpdate);

		expect(restoredDoc.getMap<StoredNode>("nodes").get("boundary")?.size).toEqual({
			width: 700,
			height: 460,
		});
		restoredDoc.destroy();
	});

	it("keeps the latest boundary size after a cold reconnect when resize-end is missed", async () => {
		const initialDoc = new Y.Doc();
		initialDoc.getMap<StoredNode>("nodes").set("boundary", {
			id: "boundary",
			type: "boundary",
			position: { x: 40, y: 60 },
			data: { label: "System boundary", kind: "boundary" },
			size: { width: 440, height: 280 },
		});
		const initialSnapshot = Y.encodeStateAsUpdate(initialDoc);
		initialDoc.destroy();

		vi.mocked(diagramApi.get).mockResolvedValueOnce({
			id: "diagram-1",
			projectId: "project-1",
			title: "Resizable boundary",
			role: "editor",
			snapshotVersion: 1,
			lastUpdateSeq: 0,
		});
		vi.mocked(crdtApi.getSnapshot).mockResolvedValueOnce(initialSnapshot);
		vi.mocked(crdtApi.postUpdate)
			.mockResolvedValueOnce({
				seq: 1,
				updateId: "update-1",
				acceptedAt: new Date().toISOString(),
			})
			.mockResolvedValueOnce({
				seq: 2,
				updateId: "update-2",
				acceptedAt: new Date().toISOString(),
			});
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

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

		await waitFor(() =>
			expect(canvasProbe.latestNodes.some((node) => node.id === "boundary")).toBe(true),
		);
		const onNodesChange = canvasProbe.onNodesChange;
		expect(onNodesChange).toBeDefined();

		act(() => {
			onNodesChange?.([
				{
					id: "boundary",
					type: "dimensions",
					dimensions: { width: 720, height: 480 },
					resizing: true,
					setAttributes: true,
				},
			]);
		});

		await waitFor(() => expect(crdtApi.postUpdate).toHaveBeenCalledTimes(1));

		act(() => {
			onNodesChange?.([
				{
					id: "boundary",
					type: "dimensions",
					dimensions: { width: 760, height: 510 },
					resizing: true,
					setAttributes: true,
				},
			]);
			window.dispatchEvent(new Event("pagehide"));
		});

		await waitFor(() => expect(crdtApi.postUpdate).toHaveBeenCalledTimes(2));
		const coldReconnectDoc = new Y.Doc();
		Y.applyUpdate(coldReconnectDoc, initialSnapshot);
		for (const call of vi.mocked(crdtApi.postUpdate).mock.calls) {
			Y.applyUpdate(coldReconnectDoc, call[1]);
		}

		expect(coldReconnectDoc.getMap<StoredNode>("nodes").get("boundary")?.size).toEqual({
			width: 760,
			height: 510,
		});
		coldReconnectDoc.destroy();
	});
});
