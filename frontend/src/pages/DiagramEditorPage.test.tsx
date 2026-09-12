import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NodeChange, ReactFlowInstance } from "@xyflow/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as Y from "yjs";

import { crdtApi, diagramApi } from "../api/endpoints";
import type { DiagramNode, StoredComment, StoredNode } from "../components/editor/diagramEditorModel";
import { DiagramEditorPage } from "./DiagramEditorPage";

const canvasProbe = vi.hoisted(() => ({
	renderCount: 0,
	selectionHandlers: new Set<unknown>(),
	latestNodes: [] as DiagramNode[],
	onNodesChange: undefined as undefined | ((changes: NodeChange<DiagramNode>[]) => void),
	onInit: undefined as undefined | ((instance: ReactFlowInstance<DiagramNode>) => void),
	onPointerMove: undefined as undefined | ((event: ReactPointerEvent<HTMLDivElement>) => void),
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
			onInit,
			onNodesChange,
			onPointerMove,
			onSelectionChange,
		}: {
			nodes: DiagramNode[];
			onInit: (instance: ReactFlowInstance<DiagramNode>) => void;
			onNodesChange: (changes: NodeChange<DiagramNode>[]) => void;
			onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
			onSelectionChange: (selection: { nodes: never[]; edges: never[] }) => void;
		}) => {
			canvasProbe.renderCount += 1;
			canvasProbe.selectionHandlers.add(onSelectionChange);
			canvasProbe.latestNodes = nodes;
			canvasProbe.onInit = onInit;
			canvasProbe.onNodesChange = onNodesChange;
			canvasProbe.onPointerMove = onPointerMove;
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
	static instances: IdleWebSocket[] = [];

	readyState: number = IdleWebSocket.CONNECTING;
	binaryType: BinaryType = "blob";
	sent: unknown[] = [];
	private listeners = new Map<string, Set<(event: { data?: unknown }) => void>>();

	constructor() {
		IdleWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	send(data: unknown) {
		this.sent.push(data);
	}
	close() {
		this.readyState = IdleWebSocket.CLOSED;
	}

	emit(type: string, data?: unknown) {
		if (type === "open") this.readyState = IdleWebSocket.OPEN;
		for (const listener of this.listeners.get(type) ?? []) listener({ data });
	}
}

describe("DiagramEditorPage integration", () => {
	beforeEach(() => {
		IdleWebSocket.instances = [];
		canvasProbe.renderCount = 0;
		canvasProbe.selectionHandlers.clear();
		canvasProbe.latestNodes = [];
		canvasProbe.onInit = undefined;
		canvasProbe.onNodesChange = undefined;
		canvasProbe.onPointerMove = undefined;
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

	it("broadcasts the latest cursor position once per animation frame", async () => {
		let pendingFrame: FrameRequestCallback | null = null;
		const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
			pendingFrame = callback;
			return 7;
		});
		vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
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

		await waitFor(() => expect(IdleWebSocket.instances).toHaveLength(1));
		const websocket = IdleWebSocket.instances[0];
		act(() => {
			canvasProbe.onInit?.({
				screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x / 2, y: y / 2 }),
			} as ReactFlowInstance<DiagramNode>);
			websocket.emit("open");
		});
		const messagesBeforeMovement = websocket.sent.length;

		act(() => {
			canvasProbe.onPointerMove?.({ clientX: 20, clientY: 40 } as ReactPointerEvent<HTMLDivElement>);
			canvasProbe.onPointerMove?.({ clientX: 42, clientY: 86 } as ReactPointerEvent<HTMLDivElement>);
		});

		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(websocket.sent).toHaveLength(messagesBeforeMovement);
		act(() => pendingFrame?.(16));

		expect(websocket.sent).toHaveLength(messagesBeforeMovement + 1);
		expect(JSON.parse(websocket.sent.at(-1) as string).presence.cursor).toEqual({ x: 21, y: 43 });
	});

	it("does not apply content mutations to a viewer's local document", async () => {
		const initialDoc = new Y.Doc();
		initialDoc.getMap<StoredNode>("nodes").set("node-1", {
			id: "node-1",
			type: "default",
			position: { x: 40, y: 60 },
			data: { label: "Read only", kind: "component" },
		});
		const initialSnapshot = Y.encodeStateAsUpdate(initialDoc);
		initialDoc.destroy();
		vi.mocked(crdtApi.getSnapshot).mockResolvedValueOnce(initialSnapshot);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter initialEntries={["/workspaces/workspace-1/projects/project-1/diagrams/diagram-1/editor"]}>
					<Routes>
						<Route
							path="/workspaces/:workspaceId/projects/:projectId/diagrams/:diagramId/editor"
							element={<DiagramEditorPage />}
						/>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		await waitFor(() => expect(canvasProbe.latestNodes).toHaveLength(1));
		act(() => canvasProbe.onNodesChange?.([{
			type: "position",
			id: "node-1",
			position: { x: 400, y: 600 },
			dragging: false,
		}]));

		expect(canvasProbe.latestNodes[0].position).toEqual({ x: 40, y: 60 });
		expect(crdtApi.postUpdate).not.toHaveBeenCalled();
	});

	it("stops local content mutations immediately after a live role downgrade", async () => {
		const initialDoc = new Y.Doc();
		initialDoc.getMap<StoredNode>("nodes").set("node-1", {
			id: "node-1",
			type: "default",
			position: { x: 40, y: 60 },
			data: { label: "Editable", kind: "component" },
		});
		const initialSnapshot = Y.encodeStateAsUpdate(initialDoc);
		initialDoc.destroy();
		vi.mocked(diagramApi.get).mockResolvedValueOnce({
			id: "diagram-1",
			projectId: "project-1",
			title: "Runtime test",
			role: "editor",
			snapshotVersion: 1,
			lastUpdateSeq: 0,
		});
		vi.mocked(crdtApi.getSnapshot).mockResolvedValueOnce(initialSnapshot);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		render(
			<QueryClientProvider client={queryClient}>
				<MemoryRouter initialEntries={["/workspaces/workspace-1/projects/project-1/diagrams/diagram-1/editor"]}>
					<Routes>
						<Route
							path="/workspaces/:workspaceId/projects/:projectId/diagrams/:diagramId/editor"
							element={<DiagramEditorPage />}
						/>
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);

		await waitFor(() => {
			expect(canvasProbe.latestNodes).toHaveLength(1);
			expect(IdleWebSocket.instances).toHaveLength(1);
		});
		act(() => IdleWebSocket.instances[0].emit("message", JSON.stringify({
			type: "access:changed",
			workspaceId: "workspace-1",
			projectId: "project-1",
			diagramId: "diagram-1",
			role: "viewer",
		})));
		act(() => canvasProbe.onNodesChange?.([{
			type: "position",
			id: "node-1",
			position: { x: 400, y: 600 },
			dragging: false,
		}]));

		expect(canvasProbe.latestNodes[0].position).toEqual({ x: 40, y: 60 });
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

	it("moves and durably persists everything contained by a dragged boundary", async () => {
		const initialDoc = new Y.Doc();
		const initialNodes = initialDoc.getMap<StoredNode>("nodes");
		initialNodes.set("boundary", {
			id: "boundary",
			type: "boundary",
			position: { x: 40, y: 60 },
			data: { label: "System boundary", kind: "boundary" },
			size: { width: 440, height: 280 },
		});
		initialNodes.set("inside", {
			id: "inside",
			type: "default",
			position: { x: 100, y: 130 },
			data: { label: "Backend API", kind: "service" },
		});
		initialNodes.set("outside", {
			id: "outside",
			type: "default",
			position: { x: 600, y: 130 },
			data: { label: "Partner API", kind: "external" },
		});
		initialDoc.getMap<StoredComment>("comments").set("comment-inside", {
			id: "comment-inside",
			position: { x: 180, y: 180 },
			size: { width: 200, height: 140 },
			text: "Moves with the system",
			authorName: "Researcher",
			createdAt: new Date().toISOString(),
		});
		const initialSnapshot = Y.encodeStateAsUpdate(initialDoc);
		initialDoc.destroy();

		vi.mocked(diagramApi.get).mockResolvedValueOnce({
			id: "diagram-1",
			projectId: "project-1",
			title: "Grouped boundary",
			role: "editor",
			snapshotVersion: 1,
			lastUpdateSeq: 0,
		});
		vi.mocked(crdtApi.getSnapshot).mockResolvedValueOnce(initialSnapshot);
		vi.mocked(crdtApi.postUpdate).mockResolvedValue({
			seq: 1,
			updateId: "group-update",
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
			expect(canvasProbe.latestNodes.some((node) => node.id === "comment-inside")).toBe(true),
		);
		const onNodesChange = canvasProbe.onNodesChange;
		expect(onNodesChange).toBeDefined();

		act(() => {
			onNodesChange?.([
				{
					id: "boundary",
					type: "position",
					position: { x: 90, y: 100 },
					dragging: true,
				},
			]);
			onNodesChange?.([
				{
					id: "boundary",
					type: "position",
					position: { x: 90, y: 100 },
					dragging: false,
				},
			]);
		});

		await waitFor(() => {
			expect(canvasProbe.latestNodes.find((node) => node.id === "boundary")?.position).toEqual({
				x: 90,
				y: 100,
			});
			expect(canvasProbe.latestNodes.find((node) => node.id === "inside")?.position).toEqual({
				x: 150,
				y: 170,
			});
			expect(canvasProbe.latestNodes.find((node) => node.id === "comment-inside")?.position).toEqual({
				x: 230,
				y: 220,
			});
			expect(canvasProbe.latestNodes.find((node) => node.id === "outside")?.position).toEqual({
				x: 600,
				y: 130,
			});
		});
		await waitFor(() => expect(crdtApi.postUpdate).toHaveBeenCalledTimes(2));

		const coldReconnectDoc = new Y.Doc();
		Y.applyUpdate(coldReconnectDoc, initialSnapshot);
		for (const call of vi.mocked(crdtApi.postUpdate).mock.calls) {
			Y.applyUpdate(coldReconnectDoc, call[1]);
		}

		expect(coldReconnectDoc.getMap<StoredNode>("nodes").get("boundary")?.position).toEqual({
			x: 90,
			y: 100,
		});
		expect(coldReconnectDoc.getMap<StoredNode>("nodes").get("inside")?.position).toEqual({
			x: 150,
			y: 170,
		});
		expect(coldReconnectDoc.getMap<StoredNode>("nodes").get("outside")?.position).toEqual({
			x: 600,
			y: 130,
		});
		expect(
			coldReconnectDoc.getMap<StoredComment>("comments").get("comment-inside")?.position,
		).toEqual({ x: 230, y: 220 });
		coldReconnectDoc.destroy();
	});
});
