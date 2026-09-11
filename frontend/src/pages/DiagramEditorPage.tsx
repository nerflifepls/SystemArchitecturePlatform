import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	reconnectEdge,
	type ReactFlowInstance,
	type Connection,
	type EdgeChange,
	type NodeChange,
} from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useParams } from "react-router-dom";
import * as Y from "yjs";

import { ApiError } from "../api/client";
import { crdtApi, diagramApi } from "../api/endpoints";
import type { CrdtUpdatesResponseDto, DiagramSnapshotDto, PresenceCursorDto } from "../api/types";
import { DiagramCanvas } from "../components/editor/DiagramCanvas";
import { DiagramEditorPanel } from "../components/editor/DiagramEditorPanel";
import { CommentNode, DiagramBoundaryNode, DiagramComponentNode } from "../components/editor/DiagramNodes";
import { analyzeArchitecture, type ArchitectureInsight } from "../components/editor/architectureInsights";
import {
	createDiagramDocument,
	exportDiagram,
	parseDiagramDocument,
} from "../components/editor/diagramDocument";
import {
	alignDiagramNodes,
	autoLayoutDiagram,
	type AlignmentAxis,
	type LayoutDirection,
} from "../components/editor/diagramLayout";
import {
	readPendingQueue,
	writePendingQueue,
	type QueuedDiagramUpdate,
} from "../components/editor/offlineUpdateQueue";
import {
	COMMENT_DEFAULT_SIZE,
	INITIAL_UPDATE_COMPACTION_THRESHOLD,
	INIT_ORIGIN,
	LOCAL_ORIGIN,
	LIVE_DRAG_ORIGIN,
	PROTOCOL_PRESETS,
	REMOTE_ORIGIN,
	clampCommentSize,
	commentNodeDataMatches,
	commentSizesEqual,
	DIAGRAM_EDGE_TYPE,
	getFallbackCommentPosition,
	getNodeChangeId,
	isCommentNodeId,
	makeDefaultEdges,
	makeDefaultNodes,
	positionsEqual,
	snapNodePosition,
	sortComments,
	toArrayBuffer,
	toFlowEdge,
	toFlowNode,
	toStoredEdge,
	toStoredNode,
	updateDtoToBytes,
	type CommentSize,
	type DiagramEdge,
	type DiagramNode,
	type FlowPosition,
	type StoredComment,
	type StoredEdge,
	type StoredNode,
	type SyncState,
} from "../components/editor/diagramEditorModel";
import { classNames } from "../components/ui/classNames";
import { useSession } from "../hooks/useAuth";
import { getErrorMessage } from "../utils/errors";
import { canEditWorkspaceContent } from "../utils/roles";
import {
	buildLiveWsUrl,
	createVibrantCursorColor,
	getEditorConnections,
	getUniquePresenceUsers,
	parsePresenceFrame,
	reducePresenceConnections,
	type PresenceConnection,
} from "../utils/presence";
import styles from "./DiagramEditorPage.module.css";

type SnapshotIntent = {
	name?: string;
	reason: DiagramSnapshotDto["reason"];
};

export function DiagramEditorPage() {
	const { workspaceId = "", projectId = "", diagramId = "" } = useParams();
	const queryClient = useQueryClient();
	const doc = useMemo(() => new Y.Doc({ guid: diagramId }), [diagramId]);
	const maps = useMemo(
		() => ({
			nodes: doc.getMap<StoredNode>("nodes"),
			edges: doc.getMap<StoredEdge>("edges"),
			docs: doc.getMap("docs"),
			comments: doc.getMap<StoredComment>("comments"),
		}),
		[doc],
	);
	const undoManager = useMemo(
		() =>
			new Y.UndoManager([maps.nodes, maps.edges, maps.comments], {
				trackedOrigins: new Set([LOCAL_ORIGIN]),
				captureTimeout: 350,
			}),
		[maps.comments, maps.edges, maps.nodes],
	);
	const [nodes, setNodes] = useState<DiagramNode[]>([]);
	const [edges, setEdges] = useState<DiagramEdge[]>([]);
	const [comments, setComments] = useState<StoredComment[]>([]);
	const [syncState, setSyncState] = useState<SyncState>("loading");
	const [initializedDiagramId, setInitializedDiagramId] = useState<string | null>(null);
	const [lastError, setLastError] = useState<string | null>(null);
	const [presenceConnections, setPresenceConnections] = useState<Record<string, PresenceConnection>>({});
	const [ownConnectionId, setOwnConnectionId] = useState<string | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
	const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
	const [nodeLabelDraft, setNodeLabelDraft] = useState("");
	const [edgeLabelDraft, setEdgeLabelDraft] = useState("");
	const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
	const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false);
	const [pendingUpdateCount, setPendingUpdateCount] = useState(0);
	const [snapshotVersion, setSnapshotVersion] = useState(1);
	const [lastUpdateSeq, setLastUpdateSeq] = useState(0);
	const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
	const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
	const [reconnectAttempt, setReconnectAttempt] = useState(0);
	const [websocketGeneration, setWebsocketGeneration] = useState(0);
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);
	const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
	const nodesRef = useRef<DiagramNode[]>([]);
	const edgesRef = useRef<DiagramEdge[]>([]);
	const commentsRef = useRef<StoredComment[]>([]);
	const commentNodeCacheRef = useRef<Map<string, DiagramNode>>(new Map());
	const canvasFrameRef = useRef<HTMLDivElement | null>(null);
	const websocketRef = useRef<WebSocket | null>(null);
	const reactFlowInstanceRef = useRef<ReactFlowInstance<DiagramNode, DiagramEdge> | null>(null);
	const snapshotTimerRef = useRef<number | null>(null);
	const persistedSyncTimerRef = useRef<number | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const pingTimerRef = useRef<number | null>(null);
	const pingSentAtRef = useRef<number | null>(null);
	const snapshotAppliedRef = useRef(false);
	const initialUpdatesAppliedRef = useRef(false);
	const clientIdRef = useRef(crypto.randomUUID());
	const cursorColorRef = useRef(createVibrantCursorColor());
	const lastPresenceSentAtRef = useRef(0);
	const persistedUpdateSeqRef = useRef(0);
	const pendingUpdatePromisesRef = useRef<Set<Promise<void>>>(new Set());
	const pendingQueueRef = useRef<QueuedDiagramUpdate[]>([]);
	const queueFlushPromiseRef = useRef<Promise<void> | null>(null);
	const pendingQueueLoadedRef = useRef(false);
	const reconnectAttemptsRef = useRef(0);
	const persistedSyncPromiseRef = useRef<Promise<number> | null>(null);
	const canEditRef = useRef(false);
	const ownConnectionIdRef = useRef<string | null>(null);
	const syncedConnectionIdsRef = useRef<Set<string>>(new Set());
	const editorConnections = getEditorConnections(presenceConnections);
	const editorUsers = getUniquePresenceUsers(editorConnections);
	const remoteCursorConnections = editorConnections.filter(
		(connection) => connection.connectionId !== ownConnectionId && connection.cursor,
	);
	const selectedNode = useMemo(
		() => nodes.find((node) => node.id === selectedNodeId) ?? null,
		[nodes, selectedNodeId],
	);
	const selectedEdge = useMemo(
		() => edges.find((edge) => edge.id === selectedEdgeId) ?? null,
		[edges, selectedEdgeId],
	);
	const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
	const assessment = useMemo(() => analyzeArchitecture(nodes, edges), [edges, nodes]);
	const documentByteSize = useMemo(() => Y.encodeStateAsUpdate(doc).byteLength, [comments, doc, edges, nodes]);
	const selectedProtocolValue =
		edgeLabelDraft ?
			PROTOCOL_PRESETS.some((protocol) => protocol === edgeLabelDraft) ?
				edgeLabelDraft
			:	"custom"
		:	"";
	const nodeTypes = useMemo(
		() => ({ default: DiagramComponentNode, boundary: DiagramBoundaryNode, comment: CommentNode }),
		[],
	);

	const sessionQuery = useSession();

	const diagramQuery = useQuery({
		queryKey: ["diagram", diagramId],
		queryFn: ({ signal }) => diagramApi.get(diagramId, signal),
		enabled: Boolean(diagramId),
		refetchOnWindowFocus: false,
	});
	const canEdit = canEditWorkspaceContent(diagramQuery.data?.role);
	const readOnly = !canEdit;
	const initialSyncReady = initializedDiagramId === diagramId;

	const updatesQuery = useQuery({
		queryKey: ["diagram", diagramId, "updates"],
		queryFn: ({ signal }) => crdtApi.listUpdates(diagramId, { signal }),
		enabled: Boolean(diagramId),
		refetchOnWindowFocus: false,
	});

	const snapshotQuery = useQuery({
		queryKey: ["diagram", diagramId, "snapshot"],
		queryFn: ({ signal }) => crdtApi.getSnapshot(diagramId, signal),
		enabled:
			Boolean(diagramId) &&
			(updatesQuery.isSuccess || updatesQuery.isError) &&
			!updatesQuery.isFetching,
		refetchOnWindowFocus: false,
	});

	const historyQuery = useQuery({
		queryKey: ["diagram", diagramId, "snapshots"],
		queryFn: ({ signal }) => crdtApi.listSnapshots(diagramId, signal),
		enabled: Boolean(diagramId) && diagramQuery.isSuccess,
		refetchOnWindowFocus: false,
	});

	const hasEditorStatus = snapshotQuery.isError || updatesQuery.isError || diagramQuery.isError || Boolean(lastError);
	const snapshotReady = (snapshotQuery.isSuccess || snapshotQuery.isError) && !snapshotQuery.isFetching;
	const updatesReady = (updatesQuery.isSuccess || updatesQuery.isError) && !updatesQuery.isFetching;

	useEffect(() => {
		if (!diagramQuery.data) return;
		setSnapshotVersion((current) => Math.max(current, diagramQuery.data.snapshotVersion ?? 1));
		setLastUpdateSeq((current) => Math.max(current, diagramQuery.data.lastUpdateSeq ?? 0));
	}, [diagramQuery.data]);

	useEffect(() => {
		const updateUndoState = () => {
			setCanUndo(undoManager.undoStack.length > 0);
			setCanRedo(undoManager.redoStack.length > 0);
		};
		undoManager.on("stack-item-added", updateUndoState);
		undoManager.on("stack-item-popped", updateUndoState);
		undoManager.on("stack-cleared", updateUndoState);
		updateUndoState();
		return () => {
			undoManager.off("stack-item-added", updateUndoState);
			undoManager.off("stack-item-popped", updateUndoState);
			undoManager.off("stack-cleared", updateUndoState);
		};
	}, [undoManager]);

	const isCompactedSequenceError = useCallback((error: unknown) => {
		return error instanceof ApiError && error.status === 409 && error.message.includes("compacted snapshot");
	}, []);

	const applyPersistedUpdates = useCallback(
		(updatesResponse: CrdtUpdatesResponseDto) => {
			let latestAppliedSeq = Math.max(
				persistedUpdateSeqRef.current,
				updatesResponse.snapshotBaseUpdateSeq,
				updatesResponse.lastUpdateSeq,
			);

			for (const update of updatesResponse.items) {
				const bytes = updateDtoToBytes(update);

				if (bytes.length) {
					Y.applyUpdate(doc, bytes, REMOTE_ORIGIN);
				}

				latestAppliedSeq = Math.max(latestAppliedSeq, update.seq);
			}

			persistedUpdateSeqRef.current = Math.max(persistedUpdateSeqRef.current, latestAppliedSeq);
			setLastUpdateSeq(persistedUpdateSeqRef.current);
			setLastSyncedAt(new Date().toISOString());
			return persistedUpdateSeqRef.current;
		},
		[doc],
	);

	const syncPersistedUpdates = useCallback(async () => {
		if (!diagramId) {
			return persistedUpdateSeqRef.current;
		}

		if (persistedSyncPromiseRef.current) {
			return persistedSyncPromiseRef.current;
		}

		const syncPromise = crdtApi
			.listUpdates(diagramId, { afterSeq: persistedUpdateSeqRef.current })
			.catch(async (error: unknown) => {
				if (!isCompactedSequenceError(error)) {
					throw error;
				}

				const updates = await crdtApi.listUpdates(diagramId);
				const snapshot = await crdtApi.getSnapshot(diagramId);

				if (snapshot.byteLength) {
					Y.applyUpdate(doc, snapshot, REMOTE_ORIGIN);
				}

				return updates;
			})
			.then(applyPersistedUpdates);

		persistedSyncPromiseRef.current = syncPromise;

		try {
			return await syncPromise;
		} finally {
			if (persistedSyncPromiseRef.current === syncPromise) {
				persistedSyncPromiseRef.current = null;
			}
		}
	}, [applyPersistedUpdates, diagramId, doc, isCompactedSequenceError]);

	const flushPendingQueue = useCallback(() => {
		if (queueFlushPromiseRef.current) {
			return queueFlushPromiseRef.current;
		}

		const flushPromise = (async () => {
			if (!diagramId || !navigator.onLine) return;
			const queue = pendingQueueRef.current;

			while (queue.length > 0 && navigator.onLine) {
				const queuedUpdate = queue[0];
				const ack = await crdtApi.postUpdate(
					diagramId,
					queuedUpdate.bytes,
					queuedUpdate.updateId,
					clientIdRef.current,
				);

				if (pendingQueueRef.current === queue && !queuedUpdate.broadcasted && websocketRef.current?.readyState === WebSocket.OPEN) {
					websocketRef.current.send(toArrayBuffer(queuedUpdate.bytes));
				}

				const previousSeq = persistedUpdateSeqRef.current;
				queue.shift();
				writePendingQueue(diagramId, queue);
				if (pendingQueueRef.current !== queue) return;
				setPendingUpdateCount(queue.length);
				if (ack.seq > previousSeq + 1) {
					await syncPersistedUpdates();
				} else {
					persistedUpdateSeqRef.current = Math.max(persistedUpdateSeqRef.current, ack.seq);
					setLastUpdateSeq(persistedUpdateSeqRef.current);
					setLastSyncedAt(new Date().toISOString());
				}
			}
		})()
			.catch((error: unknown) => {
				setLastError(
					navigator.onLine ? getErrorMessage(error) : "Offline changes are safe on this device and will sync automatically.",
				);
				setSyncState(navigator.onLine ? "error" : "offline");
				throw error;
			})
			.finally(() => {
				queueFlushPromiseRef.current = null;
			});

		queueFlushPromiseRef.current = flushPromise;
		return flushPromise;
	}, [diagramId, syncPersistedUpdates]);

	const enqueuePendingUpdate = useCallback(
		(update: Uint8Array) => {
			const copiedBytes = new Uint8Array(update.byteLength);
			copiedBytes.set(update);
			let broadcasted = false;
			if (websocketRef.current?.readyState === WebSocket.OPEN) {
				try {
					websocketRef.current.send(toArrayBuffer(copiedBytes));
					broadcasted = true;
				} catch {
					broadcasted = false;
				}
			}
			pendingQueueRef.current.push({ updateId: crypto.randomUUID(), bytes: copiedBytes, broadcasted });
			writePendingQueue(diagramId, pendingQueueRef.current);
			setPendingUpdateCount(pendingQueueRef.current.length);
			void flushPendingQueue().catch(() => undefined);
		},
		[diagramId, flushPendingQueue],
	);

	const waitForPendingUpdates = useCallback(async () => {
		await flushPendingQueue().catch(() => undefined);
		const pendingUpdates = Array.from(pendingUpdatePromisesRef.current);

		if (pendingUpdates.length > 0) {
			await Promise.allSettled(pendingUpdates);
		}
		if (pendingQueueRef.current.length > 0) {
			throw new Error("Pending offline changes must sync before a durable snapshot can be created.");
		}
	}, [flushPendingQueue]);

	const sendPresenceUpdate = useCallback((cursor: PresenceCursorDto | null, force = false) => {
		const websocket = websocketRef.current;

		if (!websocket || websocket.readyState !== WebSocket.OPEN) {
			return;
		}

		const now = Date.now();

		if (!force && now - lastPresenceSentAtRef.current < 70) {
			return;
		}

		lastPresenceSentAtRef.current = now;
		websocket.send(
			JSON.stringify({
				type: "presence:update",
				presence: {
					clientId: clientIdRef.current,
					scope: "editor",
					cursor,
					selection: null,
					activeDocId: null,
					color: cursorColorRef.current,
					status: canEditRef.current ? (cursor ? "editing" : "in editor") : "viewing",
				},
			}),
		);
	}, []);

	useEffect(() => {
		canEditRef.current = canEdit;

		if (canEdit && websocketRef.current?.readyState === WebSocket.OPEN) {
			sendPresenceUpdate(null, true);
		}
	}, [canEdit, sendPresenceUpdate]);

	const schedulePersistedSync = useCallback(() => {
		if (persistedSyncTimerRef.current) {
			window.clearTimeout(persistedSyncTimerRef.current);
		}

		persistedSyncTimerRef.current = window.setTimeout(() => {
			persistedSyncTimerRef.current = null;
			void syncPersistedUpdates().catch((error: unknown) => {
				setLastError(getErrorMessage(error));
				setSyncState("error");
			});
		}, 350);
	}, [syncPersistedUpdates]);

	const saveSnapshot = useMutation({
		mutationFn: async (intent: SnapshotIntent) => {
			await waitForPendingUpdates();
			const baseUpdateSeq = await syncPersistedUpdates();
			const snapshotBytes = Y.encodeStateAsUpdate(doc);

			return crdtApi.saveSnapshot(diagramId, snapshotBytes, baseUpdateSeq, clientIdRef.current, intent);
		},
		onMutate: () => setSyncState("saving"),
		onSuccess: (result) => {
			setSnapshotVersion(result.snapshotVersion);
			setLastUpdateSeq(result.lastUpdateSeq);
			setLastSyncedAt(result.savedAt ?? new Date().toISOString());
			setSyncState(websocketRef.current?.readyState === WebSocket.OPEN ? "live" : "offline");
			void queryClient.invalidateQueries({ queryKey: ["diagram", diagramId, "snapshots"] });
		},
		onError: (error) => {
			setLastError(getErrorMessage(error));
			setSyncState("error");
		},
	});

	const syncNodesFromSharedMap = useCallback(() => {
		const nextNodes = Array.from(maps.nodes.values()).map(toFlowNode);

		nodesRef.current = nextNodes;
		setNodes(nextNodes);
	}, [maps.nodes]);

	const syncEdgesFromSharedMap = useCallback(() => {
		const nextEdges = Array.from(maps.edges.values()).map(toFlowEdge);

		edgesRef.current = nextEdges;
		setEdges(nextEdges);
	}, [maps.edges]);

	const syncCommentsFromSharedMap = useCallback(() => {
		const nextComments = sortComments(Array.from(maps.comments.values()));

		commentsRef.current = nextComments;
		setComments(nextComments);
	}, [maps.comments]);

	const syncFromSharedMaps = useCallback(() => {
		syncNodesFromSharedMap();
		syncEdgesFromSharedMap();
		syncCommentsFromSharedMap();
	}, [syncCommentsFromSharedMap, syncEdgesFromSharedMap, syncNodesFromSharedMap]);

	const restoreSnapshot = useMutation({
		mutationFn: async (snapshot: DiagramSnapshotDto) => {
			const snapshotBytes = await crdtApi.getSnapshotVersion(diagramId, snapshot.snapshotVersion);
			const restoredDoc = new Y.Doc();
			Y.applyUpdate(restoredDoc, snapshotBytes, INIT_ORIGIN);
			const restoredNodes = restoredDoc.getMap<StoredNode>("nodes");
			const restoredEdges = restoredDoc.getMap<StoredEdge>("edges");
			const restoredComments = restoredDoc.getMap<StoredComment>("comments");
			const restoredDocs = restoredDoc.getMap("docs");

			doc.transact(() => {
				for (const key of Array.from(maps.nodes.keys())) maps.nodes.delete(key);
				for (const key of Array.from(maps.edges.keys())) maps.edges.delete(key);
				for (const key of Array.from(maps.comments.keys())) maps.comments.delete(key);
				for (const key of Array.from(maps.docs.keys())) maps.docs.delete(key);
				restoredNodes.forEach((value, key) => maps.nodes.set(key, value));
				restoredEdges.forEach((value, key) => maps.edges.set(key, value));
				restoredComments.forEach((value, key) => maps.comments.set(key, value));
				restoredDocs.forEach((value, key) => maps.docs.set(key, value));
			}, LOCAL_ORIGIN);

			restoredDoc.destroy();
			syncFromSharedMaps();
			setSelectedNodeId(null);
			setSelectedEdgeId(null);
			setSelectedNodeIds([]);
			return saveSnapshot.mutateAsync({
				name: `Restored from v${snapshot.snapshotVersion}`,
				reason: "restore",
			});
		},
		onMutate: (snapshot) => {
			if (snapshotTimerRef.current) {
				window.clearTimeout(snapshotTimerRef.current);
				snapshotTimerRef.current = null;
			}
			setRestoringVersion(snapshot.snapshotVersion);
			setLastError(null);
		},
		onError: (error) => {
			setLastError(getErrorMessage(error));
			setSyncState("error");
		},
		onSettled: () => setRestoringVersion(null),
	});

	const scheduleSnapshotSave = useCallback(() => {
		if (snapshotTimerRef.current) {
			window.clearTimeout(snapshotTimerRef.current);
		}

		snapshotTimerRef.current = window.setTimeout(() => {
			snapshotTimerRef.current = null;
			if (navigator.onLine) {
				saveSnapshot.mutate({ reason: "automatic" });
			}
		}, 1400);
	}, [saveSnapshot]);

	useEffect(() => {
		const nodeObserver = (event: Y.YMapEvent<StoredNode>) => {
			if (event.transaction.origin === LOCAL_ORIGIN || event.transaction.origin === LIVE_DRAG_ORIGIN) {
				return;
			}

			syncNodesFromSharedMap();
		};
		const edgeObserver = (event: Y.YMapEvent<StoredEdge>) => {
			if (event.transaction.origin === LOCAL_ORIGIN || event.transaction.origin === LIVE_DRAG_ORIGIN) {
				return;
			}

			syncEdgesFromSharedMap();
		};
		const commentObserver = (event: Y.YMapEvent<StoredComment>) => {
			if (event.transaction.origin === LOCAL_ORIGIN || event.transaction.origin === LIVE_DRAG_ORIGIN) {
				return;
			}

			syncCommentsFromSharedMap();
		};

		maps.nodes.observe(nodeObserver);
		maps.edges.observe(edgeObserver);
		maps.comments.observe(commentObserver);

		return () => {
			maps.nodes.unobserve(nodeObserver);
			maps.edges.unobserve(edgeObserver);
			maps.comments.unobserve(commentObserver);
		};
	}, [
		maps.comments,
		maps.edges,
		maps.nodes,
		syncCommentsFromSharedMap,
		syncEdgesFromSharedMap,
		syncNodesFromSharedMap,
	]);

	useEffect(() => {
		snapshotAppliedRef.current = false;
		initialUpdatesAppliedRef.current = false;
		pendingQueueLoadedRef.current = false;
		persistedUpdateSeqRef.current = 0;
		pendingQueueRef.current = [];
		setPendingUpdateCount(0);
		setLastUpdateSeq(0);
		setSnapshotVersion(1);
		setLastSyncedAt(null);
		setRoundTripMs(null);
		reconnectAttemptsRef.current = 0;
		setReconnectAttempt(0);
		setSelectedNodeIds([]);
		undoManager.clear();
		setInitializedDiagramId(null);
	}, [diagramId, undoManager]);

	useEffect(() => {
		if (snapshotAppliedRef.current || !snapshotReady) {
			return;
		}

		snapshotAppliedRef.current = true;

		if (snapshotQuery.data?.byteLength) {
			Y.applyUpdate(doc, snapshotQuery.data, INIT_ORIGIN);
		}

		syncFromSharedMaps();
	}, [doc, snapshotQuery.data, snapshotReady, syncFromSharedMaps]);

	useEffect(() => {
		if (initialUpdatesAppliedRef.current || !snapshotReady || !updatesReady || !diagramQuery.isSuccess) {
			return;
		}

		initialUpdatesAppliedRef.current = true;

		for (const update of updatesQuery.data?.items ?? []) {
			const bytes = updateDtoToBytes(update);

			if (bytes.length) {
				Y.applyUpdate(doc, bytes, INIT_ORIGIN);
			}
		}

		if (!pendingQueueLoadedRef.current && canEdit) {
			pendingQueueLoadedRef.current = true;
			pendingQueueRef.current = readPendingQueue(diagramId);
			setPendingUpdateCount(pendingQueueRef.current.length);
			for (const queuedUpdate of pendingQueueRef.current) {
				Y.applyUpdate(doc, queuedUpdate.bytes, INIT_ORIGIN);
			}
		}

		persistedUpdateSeqRef.current = Math.max(
			persistedUpdateSeqRef.current,
			updatesQuery.data?.snapshotBaseUpdateSeq ?? 0,
			updatesQuery.data?.lastUpdateSeq ?? 0,
		);
		setLastUpdateSeq(persistedUpdateSeqRef.current);

		if (canEdit && maps.nodes.size === 0) {
			doc.transact(() => {
				for (const node of makeDefaultNodes()) {
					maps.nodes.set(node.id, node);
				}

				for (const edge of makeDefaultEdges()) {
					maps.edges.set(edge.id, edge);
				}
			}, LOCAL_ORIGIN);
		}

		syncFromSharedMaps();
		setInitializedDiagramId(diagramId);
		setSyncState(navigator.onLine ? "live" : "offline");
		if (pendingQueueRef.current.length > 0) {
			void flushPendingQueue().catch(() => undefined);
		}

		if ((updatesQuery.data?.items.length ?? 0) >= INITIAL_UPDATE_COMPACTION_THRESHOLD) {
			scheduleSnapshotSave();
		}
	}, [
		canEdit,
		diagramId,
		diagramQuery.isSuccess,
		doc,
		flushPendingQueue,
		maps.edges,
		maps.nodes,
		snapshotReady,
		scheduleSnapshotSave,
		syncFromSharedMaps,
		updatesQuery.data,
		updatesReady,
	]);

	useEffect(() => {
		const handleUpdate = (update: Uint8Array, origin: unknown) => {
			if (origin === INIT_ORIGIN || origin === REMOTE_ORIGIN) {
				return;
			}

			if (!canEditRef.current) {
				return;
			}

			if (origin === LIVE_DRAG_ORIGIN) {
				if (websocketRef.current?.readyState === WebSocket.OPEN) {
					websocketRef.current.send(toArrayBuffer(update));
				}
				return;
			}

			enqueuePendingUpdate(update);
			scheduleSnapshotSave();
		};

		doc.on("update", handleUpdate);

		return () => {
			doc.off("update", handleUpdate);
		};
	}, [doc, enqueuePendingUpdate, scheduleSnapshotSave]);

	useEffect(() => {
		if (!diagramId || !initialSyncReady) {
			return;
		}
		if (!navigator.onLine) {
			setSyncState("offline");
			return;
		}
		if (reconnectTimerRef.current) {
			window.clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}

		let isCurrent = true;
		let websocket: WebSocket;

		try {
			websocket = new WebSocket(buildLiveWsUrl(diagramId));
		} catch {
			setLastError("Realtime service URL is invalid.");
			setSyncState("offline");
			return;
		}

		websocket.binaryType = "arraybuffer";
		websocketRef.current = websocket;
		setSyncState("loading");
		setLastError(null);
		setOwnConnectionId(null);
		ownConnectionIdRef.current = null;
		syncedConnectionIdsRef.current.clear();
		setPresenceConnections({});

		websocket.addEventListener("open", () => {
			if (!isCurrent || websocketRef.current !== websocket) {
				return;
			}

			setSyncState("live");
			setLastError(null);
			reconnectAttemptsRef.current = 0;
			setReconnectAttempt(0);
			sendPresenceUpdate(null, true);
			const sendPing = () => {
				if (websocket.readyState !== WebSocket.OPEN) return;
				pingSentAtRef.current = performance.now();
				websocket.send(JSON.stringify({ type: "ping" }));
			};
			sendPing();
			pingTimerRef.current = window.setInterval(sendPing, 15_000);
			void flushPendingQueue()
				.then(syncPersistedUpdates)
				.then(() => {
					if (canEditRef.current && websocket.readyState === WebSocket.OPEN) {
						websocket.send(toArrayBuffer(Y.encodeStateAsUpdate(doc)));
					}
				})
				.catch((error: unknown) => {
					setLastError(getErrorMessage(error));
					setSyncState(navigator.onLine ? "error" : "offline");
				});
		});

		websocket.addEventListener("message", (event) => {
			if (!isCurrent || websocketRef.current !== websocket) {
				return;
			}

			if (typeof event.data === "string") {
				const frame = parsePresenceFrame(event.data);

				if (!frame) {
					return;
				}

				if (frame.type === "ready" && frame.connectionId) {
					setOwnConnectionId(frame.connectionId);
					ownConnectionIdRef.current = frame.connectionId;
					return;
				}

				if (frame.type === "error") {
					setLastError(frame.message ?? "Realtime service returned an error.");
					setSyncState("error");
					return;
				}

				if (frame.type === "pong") {
					if (pingSentAtRef.current !== null) {
						setRoundTripMs(Math.max(0, Math.round(performance.now() - pingSentAtRef.current)));
						pingSentAtRef.current = null;
					}
					return;
				}

				if (
					frame.type === "presence:update" &&
					frame.connectionId &&
					frame.connectionId !== ownConnectionIdRef.current &&
					canEditRef.current &&
					!syncedConnectionIdsRef.current.has(frame.connectionId)
				) {
					syncedConnectionIdsRef.current.add(frame.connectionId);
					websocket.send(toArrayBuffer(Y.encodeStateAsUpdate(doc)));
				}

				setPresenceConnections((current) => reducePresenceConnections(current, frame));
				return;
			}

			if (event.data instanceof ArrayBuffer) {
				Y.applyUpdate(doc, new Uint8Array(event.data), REMOTE_ORIGIN);
				schedulePersistedSync();
				return;
			}

			if (event.data instanceof Blob) {
				void event.data.arrayBuffer().then((buffer) => {
					if (!isCurrent || websocketRef.current !== websocket) {
						return;
					}

					Y.applyUpdate(doc, new Uint8Array(buffer), REMOTE_ORIGIN);
					schedulePersistedSync();
				});
			}
		});

		websocket.addEventListener("close", () => {
			if (!isCurrent || websocketRef.current !== websocket) {
				return;
			}

			setSyncState("offline");
			setOwnConnectionId(null);
			if (pingTimerRef.current) {
				window.clearInterval(pingTimerRef.current);
				pingTimerRef.current = null;
			}
			if (navigator.onLine) {
				const attempt = reconnectAttemptsRef.current + 1;
				reconnectAttemptsRef.current = attempt;
				setReconnectAttempt(attempt);
				const delay = Math.min(15_000, 750 * 2 ** Math.min(attempt - 1, 5));
				reconnectTimerRef.current = window.setTimeout(() => {
					reconnectTimerRef.current = null;
					setWebsocketGeneration((current) => current + 1);
				}, delay);
			}
		});

		websocket.addEventListener("error", () => {
			if (!isCurrent || websocketRef.current !== websocket) {
				return;
			}

			setLastError("Realtime service is unavailable.");
			setSyncState("offline");
		});

		return () => {
			isCurrent = false;
			sendPresenceUpdate(null, true);
			if (pingTimerRef.current) {
				window.clearInterval(pingTimerRef.current);
				pingTimerRef.current = null;
			}
			websocket.close();
			if (websocketRef.current === websocket) {
				websocketRef.current = null;
			}
		};
	}, [
		diagramId,
		doc,
		flushPendingQueue,
		initialSyncReady,
		schedulePersistedSync,
		sendPresenceUpdate,
		syncPersistedUpdates,
		websocketGeneration,
	]);

	useEffect(() => {
		const handleOnline = () => {
			setLastError(null);
			setWebsocketGeneration((current) => current + 1);
			void flushPendingQueue().catch(() => undefined);
		};
		const handleOffline = () => {
			setSyncState("offline");
			websocketRef.current?.close();
		};
		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, [flushPendingQueue]);

	useEffect(() => {
		return () => {
			if (snapshotTimerRef.current) {
				window.clearTimeout(snapshotTimerRef.current);
			}

			if (persistedSyncTimerRef.current) {
				window.clearTimeout(persistedSyncTimerRef.current);
			}

			if (reconnectTimerRef.current) {
				window.clearTimeout(reconnectTimerRef.current);
			}

			if (pingTimerRef.current) {
				window.clearInterval(pingTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		return () => {
			undoManager.destroy();
			doc.destroy();
		};
	}, [doc, undoManager]);

	const onNodesChange = useCallback(
		(changes: NodeChange<DiagramNode>[]) => {
			const regularChanges = changes.filter((change) => !isCommentNodeId(getNodeChangeId(change)));
			const commentChanges = changes.filter((change) => isCommentNodeId(getNodeChangeId(change)));

			if (regularChanges.length > 0) {
				const snappedRegularChanges = regularChanges.map((change) => {
					if (change.type !== "position" || !change.position) {
						return change;
					}

					return {
						...change,
						position: snapNodePosition(change.id, change.position, nodesRef.current),
					};
				});
				const nextNodes = applyNodeChanges(snappedRegularChanges, nodesRef.current);
				const changedNodeIds = new Set<string>();
				const removedNodeIds = new Set<string>();
				let shouldPersistRegularChanges = false;

				for (const change of snappedRegularChanges) {
					switch (change.type) {
						case "add":
							changedNodeIds.add(change.item.id);
							shouldPersistRegularChanges = true;
							break;
						case "position":
							if (change.position) {
								changedNodeIds.add(change.id);
								shouldPersistRegularChanges ||= change.dragging !== true;
							}
							break;
						case "remove":
							removedNodeIds.add(change.id);
							shouldPersistRegularChanges = true;
							break;
						case "replace":
							removedNodeIds.add(change.id);
							changedNodeIds.add(change.item.id);
							shouldPersistRegularChanges = true;
							break;
					}
				}

				nodesRef.current = nextNodes;
				setNodes(nextNodes);

				if (removedNodeIds.size > 0) {
					const nextEdges = edgesRef.current.filter(
						(edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
					);
					const removedEdgeIds = new Set(
						edgesRef.current
							.filter((edge) => removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target))
							.map((edge) => edge.id),
					);

					edgesRef.current = nextEdges;
					setEdges(nextEdges);
					setSelectedNodeId((currentNodeId) =>
						currentNodeId && removedNodeIds.has(currentNodeId) ? null : currentNodeId,
					);
					setSelectedNodeIds((currentNodeIds) =>
						currentNodeIds.filter((currentNodeId) => !removedNodeIds.has(currentNodeId)),
					);
					setSelectedEdgeId((currentEdgeId) =>
						currentEdgeId && removedEdgeIds.has(currentEdgeId) ? null : currentEdgeId,
					);
				}

				if (changedNodeIds.size > 0 || removedNodeIds.size > 0) {
					doc.transact(
						() => {
							for (const nodeId of removedNodeIds) {
								maps.nodes.delete(nodeId);
							}

							if (removedNodeIds.size > 0) {
								for (const [edgeId, edge] of Array.from(maps.edges.entries())) {
									if (removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target)) {
										maps.edges.delete(edgeId);
									}
								}
							}

							for (const node of nextNodes) {
								if (changedNodeIds.has(node.id)) {
									maps.nodes.set(node.id, toStoredNode(node));
								}
							}
						},
						shouldPersistRegularChanges ? LOCAL_ORIGIN : LIVE_DRAG_ORIGIN,
					);
				}
			}

			if (commentChanges.length === 0) {
				return;
			}

			if (commentNodeCacheRef.current.size > 0) {
				const nextCachedCommentNodes = applyNodeChanges(
					commentChanges,
					Array.from(commentNodeCacheRef.current.values()),
				);

				commentNodeCacheRef.current = new Map(nextCachedCommentNodes.map((node) => [node.id, node]));
			}

			const changedCommentIds = new Set<string>();
			const removedCommentIds = new Set<string>();
			let commentsChanged = false;
			let shouldPersistCommentChanges = false;
			let nextComments = commentsRef.current;

			for (const change of commentChanges) {
				switch (change.type) {
					case "position":
						if (change.position) {
							commentsChanged = true;
							changedCommentIds.add(change.id);
							shouldPersistCommentChanges ||= change.dragging !== true;
							nextComments = nextComments.map((comment) =>
								comment.id === change.id ? { ...comment, position: change.position } : comment,
							);
						}
						break;
					case "remove":
						commentsChanged = true;
						removedCommentIds.add(change.id);
						shouldPersistCommentChanges = true;
						break;
					case "replace":
						commentsChanged = true;
						changedCommentIds.add(change.item.id);
						shouldPersistCommentChanges = true;
						nextComments = nextComments.map((comment) =>
							comment.id === change.item.id ? { ...comment, position: change.item.position } : comment,
						);
						break;
				}
			}

			if (!commentsChanged) {
				return;
			}

			nextComments = sortComments(nextComments.filter((comment) => !removedCommentIds.has(comment.id)));
			commentsRef.current = nextComments;
			setComments(nextComments);

			if (changedCommentIds.size === 0 && removedCommentIds.size === 0) {
				return;
			}

			doc.transact(
				() => {
					for (const commentId of removedCommentIds) {
						maps.comments.delete(commentId);
					}

					for (const comment of nextComments) {
						if (changedCommentIds.has(comment.id)) {
							maps.comments.set(comment.id, comment);
						}
					}
				},
				shouldPersistCommentChanges ? LOCAL_ORIGIN : LIVE_DRAG_ORIGIN,
			);
		},
		[doc, maps.comments, maps.edges, maps.nodes],
	);

	const onEdgesChange = useCallback(
		(changes: EdgeChange<DiagramEdge>[]) => {
			const nextEdges = applyEdgeChanges(changes, edgesRef.current);
			const changedEdgeIds = new Set<string>();
			const removedEdgeIds = new Set<string>();

			for (const change of changes) {
				switch (change.type) {
					case "add":
						changedEdgeIds.add(change.item.id);
						break;
					case "remove":
						removedEdgeIds.add(change.id);
						break;
					case "replace":
						removedEdgeIds.add(change.id);
						changedEdgeIds.add(change.item.id);
						break;
				}
			}

			edgesRef.current = nextEdges;
			setEdges(nextEdges);

			if (removedEdgeIds.size > 0) {
				setSelectedEdgeId((currentEdgeId) =>
					currentEdgeId && removedEdgeIds.has(currentEdgeId) ? null : currentEdgeId,
				);
			}

			if (changedEdgeIds.size === 0 && removedEdgeIds.size === 0) {
				return;
			}

			doc.transact(() => {
				for (const edgeId of removedEdgeIds) {
					maps.edges.delete(edgeId);
				}

				for (const edge of nextEdges) {
					if (changedEdgeIds.has(edge.id)) {
						maps.edges.set(edge.id, toStoredEdge(edge));
					}
				}
			}, LOCAL_ORIGIN);
		},
		[doc, maps.edges],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!connection.source || !connection.target) {
				return;
			}

			const edge: DiagramEdge = {
				id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
				source: connection.source,
				target: connection.target,
				sourceHandle: connection.sourceHandle ?? undefined,
				targetHandle: connection.targetHandle ?? undefined,
				type: DIAGRAM_EDGE_TYPE,
				label: "HTTPS",
			};

			const nextEdges = addEdge(edge, edgesRef.current);

			edgesRef.current = nextEdges;
			setEdges(nextEdges);

			doc.transact(() => {
				maps.edges.set(edge.id, toStoredEdge(edge));
			}, LOCAL_ORIGIN);
			setSelectedNodeId(null);
			setSelectedNodeIds([]);
			setSelectedEdgeId(edge.id);
		},
		[doc, maps.edges],
	);

	const onReconnect = useCallback(
		(oldEdge: DiagramEdge, connection: Connection) => {
			const nextEdges = reconnectEdge(oldEdge, connection, edgesRef.current);
			const updatedEdge = nextEdges.find((edge) => edge.id === oldEdge.id);

			if (!updatedEdge) {
				return;
			}

			edgesRef.current = nextEdges;
			setEdges(nextEdges);

			doc.transact(() => {
				maps.edges.set(updatedEdge.id, toStoredEdge(updatedEdge));
			}, LOCAL_ORIGIN);
		},
		[doc, maps.edges],
	);

	const handleEditorPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const reactFlowInstance = reactFlowInstanceRef.current;

			if (!reactFlowInstance) {
				return;
			}

			const cursor = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
			sendPresenceUpdate({ x: cursor.x, y: cursor.y });
		},
		[sendPresenceUpdate],
	);

	const handleEditorPointerLeave = useCallback(() => {
		sendPresenceUpdate(null, true);
	}, [sendPresenceUpdate]);

	function addNode() {
		const nodeCount = nodesRef.current.length;
		const node: StoredNode = {
			id: `node-${crypto.randomUUID()}`,
			type: "default",
			position: { x: 180 + nodeCount * 28, y: 120 + nodeCount * 22 },
			data: { label: `Component ${nodeCount + 1}`, kind: "component" },
		};
		const nextNodes = [
			...nodesRef.current.map((currentNode) => ({ ...currentNode, selected: false })),
			{ ...toFlowNode(node), selected: true },
		];

		nodesRef.current = nextNodes;
		setNodes(nextNodes);

		doc.transact(() => {
			maps.nodes.set(node.id, node);
		}, LOCAL_ORIGIN);
		setSelectedNodeId(node.id);
		setSelectedNodeIds([node.id]);
		setSelectedEdgeId(null);
	}

	function getCanvasCenter() {
		const reactFlowInstance = reactFlowInstanceRef.current;
		const canvasBounds = canvasFrameRef.current?.getBoundingClientRect();
		if (!reactFlowInstance || !canvasBounds) return null;
		return reactFlowInstance.screenToFlowPosition({
			x: canvasBounds.left + canvasBounds.width / 2,
			y: canvasBounds.top + canvasBounds.height / 2,
		});
	}

	function addBoundary() {
		const center = getCanvasCenter() ?? { x: 380, y: 260 };
		const boundary: StoredNode = {
			id: `boundary-${crypto.randomUUID()}`,
			type: "boundary",
			position: { x: center.x - 220, y: center.y - 140 },
			data: { label: "System boundary", kind: "boundary" },
		};
		const nextNodes = [
			{ ...toFlowNode(boundary), selected: true },
			...nodesRef.current.map((currentNode) => ({ ...currentNode, selected: false })),
		];
		nodesRef.current = nextNodes;
		setNodes(nextNodes);
		doc.transact(() => maps.nodes.set(boundary.id, boundary), LOCAL_ORIGIN);
		setSelectedNodeId(boundary.id);
		setSelectedNodeIds([boundary.id]);
		setSelectedEdgeId(null);
	}

	function persistNodeBatch(nextNodes: DiagramNode[], changedNodeIds: Set<string>) {
		nodesRef.current = nextNodes;
		setNodes(nextNodes);
		doc.transact(() => {
			for (const node of nextNodes) {
				if (changedNodeIds.has(node.id)) maps.nodes.set(node.id, toStoredNode(node));
			}
		}, LOCAL_ORIGIN);
	}

	function duplicateSelection() {
		const selected = nodesRef.current.filter((node) => selectedNodeIdSet.has(node.id));
		if (!selected.length) return;
		const idMap = new Map(selected.map((node) => [node.id, `${node.type === "boundary" ? "boundary" : "node"}-${crypto.randomUUID()}`]));
		const duplicates = selected.map((node) => ({
			...node,
			id: idMap.get(node.id) as string,
			position: { x: node.position.x + 36, y: node.position.y + 36 },
			selected: true,
			data: { ...node.data, label: `${node.data.label} copy` },
		}));
		const duplicateEdges = edgesRef.current
			.filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
			.map((edge) => ({
				...edge,
				id: `edge-${crypto.randomUUID()}`,
				source: idMap.get(edge.source) as string,
				target: idMap.get(edge.target) as string,
				selected: false,
			}));
		const nextNodes = [...nodesRef.current.map((node) => ({ ...node, selected: false })), ...duplicates];
		const nextEdges = [...edgesRef.current.map((edge) => ({ ...edge, selected: false })), ...duplicateEdges];
		nodesRef.current = nextNodes;
		edgesRef.current = nextEdges;
		setNodes(nextNodes);
		setEdges(nextEdges);
		doc.transact(() => {
			for (const node of duplicates) maps.nodes.set(node.id, toStoredNode(node));
			for (const edge of duplicateEdges) maps.edges.set(edge.id, toStoredEdge(edge));
		}, LOCAL_ORIGIN);
		const duplicateIds = duplicates.map((node) => node.id);
		setSelectedNodeIds(duplicateIds);
		setSelectedNodeId(duplicateIds[0] ?? null);
		setSelectedEdgeId(null);
	}

	function alignSelection(axis: AlignmentAxis) {
		const nextNodes = alignDiagramNodes(nodesRef.current, selectedNodeIdSet, axis);
		persistNodeBatch(nextNodes, selectedNodeIdSet);
	}

	function autoLayout(direction: LayoutDirection) {
		const nextNodes = autoLayoutDiagram(nodesRef.current, edgesRef.current, direction);
		persistNodeBatch(nextNodes, new Set(nextNodes.filter((node) => node.type !== "boundary").map((node) => node.id)));
		window.setTimeout(() => reactFlowInstanceRef.current?.fitView({ padding: 0.22, duration: 420 }), 0);
	}

	function focusInsight(insight: ArchitectureInsight) {
		const nodeIds = new Set(insight.nodeIds);
		const edgeIds = new Set(insight.edgeIds);
		const nextNodes = nodesRef.current.map((node) => ({ ...node, selected: nodeIds.has(node.id) }));
		const nextEdges = edgesRef.current.map((edge) => ({ ...edge, selected: edgeIds.has(edge.id) }));
		nodesRef.current = nextNodes;
		edgesRef.current = nextEdges;
		setNodes(nextNodes);
		setEdges(nextEdges);
		setSelectedNodeIds([...nodeIds]);
		setSelectedNodeId(insight.nodeIds[0] ?? null);
		setSelectedEdgeId(insight.nodeIds.length ? null : insight.edgeIds[0] ?? null);
		const focusNodes = nextNodes.filter((node) => nodeIds.has(node.id));
		if (focusNodes.length) {
			window.setTimeout(() => reactFlowInstanceRef.current?.fitView({ nodes: focusNodes, padding: 0.5, duration: 420 }), 0);
		}
	}

	function getCommentStartPosition() {
		return getCanvasCenter() ?? getFallbackCommentPosition(commentsRef.current.length);
	}

	function addComment(position = getCommentStartPosition()) {
		const currentUser = sessionQuery.data?.user;
		const now = new Date().toISOString();
		const comment: StoredComment = {
			id: `comment-${crypto.randomUUID()}`,
			position,
			size: COMMENT_DEFAULT_SIZE,
			text: "",
			authorName: currentUser?.name || currentUser?.email || "You",
			authorUserId: currentUser?.id,
			createdAt: now,
			updatedAt: now,
		};
		const nextComments = sortComments([...commentsRef.current, comment]);

		commentsRef.current = nextComments;
		setComments(nextComments);
		setFocusedCommentId(comment.id);
		setSelectedNodeId(null);
		setSelectedNodeIds([]);
		setSelectedEdgeId(null);

		doc.transact(() => {
			maps.comments.set(comment.id, comment);
		}, LOCAL_ORIGIN);
	}

	function updateNodeLabel(nodeId: string, label: string) {
		const nextNodes = nodesRef.current.map((node) =>
			node.id === nodeId ? { ...node, data: { ...node.data, label } } : node,
		);
		const updatedNode = nextNodes.find((node) => node.id === nodeId);

		if (!updatedNode) {
			return;
		}

		nodesRef.current = nextNodes;
		setNodes(nextNodes);

		doc.transact(() => {
			maps.nodes.set(nodeId, toStoredNode(updatedNode));
		}, LOCAL_ORIGIN);
	}

	function updateNodeKind(nodeId: string, kind: string) {
		const nextNodes = nodesRef.current.map((node) =>
			node.id === nodeId ? { ...node, data: { ...node.data, kind } } : node,
		);
		const updatedNode = nextNodes.find((node) => node.id === nodeId);

		if (!updatedNode) {
			return;
		}

		nodesRef.current = nextNodes;
		setNodes(nextNodes);

		doc.transact(() => {
			maps.nodes.set(nodeId, toStoredNode(updatedNode));
		}, LOCAL_ORIGIN);
	}

	function removeNode(nodeId: string) {
		const nextNodes = nodesRef.current.filter((node) => node.id !== nodeId);
		const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
		const removedEdgeIds = new Set(
			edgesRef.current.filter((edge) => edge.source === nodeId || edge.target === nodeId).map((edge) => edge.id),
		);

		nodesRef.current = nextNodes;
		edgesRef.current = nextEdges;
		setNodes(nextNodes);
		setEdges(nextEdges);
		setSelectedNodeId((currentNodeId) => (currentNodeId === nodeId ? null : currentNodeId));
		setSelectedNodeIds((currentNodeIds) => currentNodeIds.filter((currentNodeId) => currentNodeId !== nodeId));
		setSelectedEdgeId((currentEdgeId) =>
			currentEdgeId && removedEdgeIds.has(currentEdgeId) ? null : currentEdgeId,
		);

		doc.transact(() => {
			maps.nodes.delete(nodeId);

			for (const edgeId of removedEdgeIds) {
				maps.edges.delete(edgeId);
			}
		}, LOCAL_ORIGIN);
	}

	function handleRenameNode(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!selectedNode) {
			return;
		}

		const nextLabel = nodeLabelDraft.trim() || "Untitled node";
		setNodeLabelDraft(nextLabel);
		updateNodeLabel(selectedNode.id, nextLabel);
	}

	function updateEdgeLabel(edgeId: string, label: string) {
		const trimmedLabel = label.trim();
		const nextEdges = edgesRef.current.map((edge) =>
			edge.id === edgeId ? { ...edge, label: trimmedLabel || undefined } : edge,
		);
		const updatedEdge = nextEdges.find((edge) => edge.id === edgeId);

		if (!updatedEdge) {
			return;
		}

		edgesRef.current = nextEdges;
		setEdges(nextEdges);
		setEdgeLabelDraft(trimmedLabel);

		doc.transact(() => {
			maps.edges.set(edgeId, toStoredEdge(updatedEdge));
		}, LOCAL_ORIGIN);
	}

	function handleRenameEdge(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!selectedEdge) {
			return;
		}

		updateEdgeLabel(selectedEdge.id, edgeLabelDraft);
	}

	function removeEdge(edgeId: string) {
		const nextEdges = edgesRef.current.filter((edge) => edge.id !== edgeId);

		edgesRef.current = nextEdges;
		setEdges(nextEdges);
		setSelectedEdgeId((currentEdgeId) => (currentEdgeId === edgeId ? null : currentEdgeId));

		doc.transact(() => {
			maps.edges.delete(edgeId);
		}, LOCAL_ORIGIN);
	}

	const updateCommentText = useCallback(
		(commentId: string, text: string) => {
			const updatedAt = new Date().toISOString();
			const nextComments = commentsRef.current.map((comment) =>
				comment.id === commentId ? { ...comment, text, updatedAt } : comment,
			);
			const updatedComment = nextComments.find((comment) => comment.id === commentId);

			if (!updatedComment) {
				return;
			}

			commentsRef.current = nextComments;
			setComments(nextComments);

			doc.transact(() => {
				maps.comments.set(commentId, updatedComment);
			}, LOCAL_ORIGIN);
		},
		[doc, maps.comments],
	);

	const removeComment = useCallback(
		(commentId: string) => {
			const nextComments = commentsRef.current.filter((comment) => comment.id !== commentId);

			commentsRef.current = nextComments;
			setComments(nextComments);
			setFocusedCommentId((currentCommentId) => (currentCommentId === commentId ? null : currentCommentId));

			doc.transact(() => {
				maps.comments.delete(commentId);
			}, LOCAL_ORIGIN);
		},
		[doc, maps.comments],
	);

	const clearFocusedComment = useCallback((commentId: string) => {
		setFocusedCommentId((currentCommentId) => (currentCommentId === commentId ? null : currentCommentId));
	}, []);

	const persistNodePosition = useCallback(
		(nodeId: string, position: FlowPosition) => {
			const currentNode = nodesRef.current.find((node) => node.id === nodeId);

			if (!currentNode) {
				return;
			}

			const nextPosition = snapNodePosition(nodeId, position, nodesRef.current);
			const storedNode = maps.nodes.get(nodeId);

			if (storedNode && positionsEqual(storedNode.position, nextPosition)) {
				return;
			}

			const updatedNode = { ...currentNode, position: nextPosition };

			if (!positionsEqual(currentNode.position, nextPosition)) {
				const nextNodes = nodesRef.current.map((node) => (node.id === nodeId ? updatedNode : node));

				nodesRef.current = nextNodes;
				setNodes(nextNodes);
			}

			doc.transact(() => {
				maps.nodes.set(nodeId, toStoredNode(updatedNode));
			}, LOCAL_ORIGIN);
		},
		[doc, maps.nodes],
	);

	const persistCommentPosition = useCallback(
		(commentId: string, position: FlowPosition) => {
			const currentComment = commentsRef.current.find((comment) => comment.id === commentId);

			if (!currentComment) {
				return;
			}

			const updatedComment =
				positionsEqual(currentComment.position, position) ? currentComment : { ...currentComment, position };

			if (updatedComment !== currentComment) {
				const nextComments = commentsRef.current.map((comment) =>
					comment.id === commentId ? updatedComment : comment,
				);

				commentsRef.current = nextComments;
				setComments(nextComments);
			}

			doc.transact(() => {
				maps.comments.set(commentId, updatedComment);
			}, LOCAL_ORIGIN);
		},
		[doc, maps.comments],
	);

	const updateCommentSize = useCallback(
		(commentId: string, size: CommentSize) => {
			const nextSize = clampCommentSize(size);
			const nextComments = commentsRef.current.map((comment) =>
				comment.id === commentId ?
					{ ...comment, size: nextSize, updatedAt: new Date().toISOString() }
				:	comment,
			);
			const updatedComment = nextComments.find((comment) => comment.id === commentId);

			if (!updatedComment) {
				return;
			}

			commentsRef.current = nextComments;
			setComments(nextComments);

			doc.transact(() => {
				maps.comments.set(commentId, updatedComment);
			}, LOCAL_ORIGIN);
		},
		[doc, maps.comments],
	);

	async function handleExport(format: "json" | "svg" | "png" | "pdf") {
		try {
			setLastError(null);
			await exportDiagram(
				createDiagramDocument(
					diagramQuery.data?.title ?? "System design",
					nodesRef.current,
					edgesRef.current,
					commentsRef.current,
				),
				format,
			);
		} catch (error) {
			setLastError(getErrorMessage(error));
		}
	}

	async function handleImport(file: File) {
		if (!canEdit) return;
		try {
			if (snapshotTimerRef.current) {
				window.clearTimeout(snapshotTimerRef.current);
				snapshotTimerRef.current = null;
			}
			setLastError(null);
			const imported = parseDiagramDocument(await file.text());
			doc.transact(() => {
				for (const key of Array.from(maps.nodes.keys())) maps.nodes.delete(key);
				for (const key of Array.from(maps.edges.keys())) maps.edges.delete(key);
				for (const key of Array.from(maps.comments.keys())) maps.comments.delete(key);
				for (const key of Array.from(maps.docs.keys())) maps.docs.delete(key);
				for (const node of imported.diagram.nodes) maps.nodes.set(node.id, node);
				for (const edge of imported.diagram.edges) maps.edges.set(edge.id, edge);
				for (const comment of imported.diagram.comments) maps.comments.set(comment.id, comment);
			}, LOCAL_ORIGIN);
			syncFromSharedMaps();
			setSelectedNodeId(null);
			setSelectedNodeIds([]);
			setSelectedEdgeId(null);
			await saveSnapshot.mutateAsync({ name: `Imported ${file.name}`, reason: "import" });
			window.setTimeout(() => reactFlowInstanceRef.current?.fitView({ padding: 0.22, duration: 420 }), 0);
		} catch (error) {
			setLastError(getErrorMessage(error));
			setSyncState(navigator.onLine ? "error" : "offline");
		}
	}

	const flowNodes = useMemo(() => {
		const previousCommentNodes = commentNodeCacheRef.current;
		const nextCommentNodes = new Map<string, DiagramNode>();
		const commentFlowNodes = comments.map((comment, index) => {
			const previousNode = previousCommentNodes.get(comment.id);
			const position = comment.position ?? getFallbackCommentPosition(index);
			const size = comment.size ?? COMMENT_DEFAULT_SIZE;
			const shouldFocus = canEdit && focusedCommentId === comment.id;
			const data =
				previousNode && commentNodeDataMatches(previousNode.data, comment, size, shouldFocus, readOnly) ?
					previousNode.data
				:	{
						label: "Comment",
						kind: "comment",
						size,
						text: comment.text,
						authorName: comment.authorName,
						createdAt: comment.createdAt,
						updatedAt: comment.updatedAt,
						shouldFocus,
						readOnly,
						onDelete: removeComment,
						onFocusHandled: clearFocusedComment,
						onResize: updateCommentSize,
						onTextChange: updateCommentText,
					};
			const style = previousNode && commentSizesEqual(previousNode.data.size, size) ? previousNode.style : size;
			const nextNode =
				(
					previousNode &&
					positionsEqual(previousNode.position, position) &&
					previousNode.data === data &&
					previousNode.style === style
				) ?
					previousNode
				: previousNode ?
					{
						...previousNode,
						position,
						style,
						data,
					}
				:	{
						id: comment.id,
						type: "comment",
						position,
						style,
						data,
					};

			nextCommentNodes.set(comment.id, nextNode);
			return nextNode;
		});

		commentNodeCacheRef.current = nextCommentNodes;
		return [...nodes, ...commentFlowNodes];
	}, [canEdit, clearFocusedComment, comments, focusedCommentId, nodes, readOnly, removeComment, updateCommentSize, updateCommentText]);

	useEffect(() => {
		setNodeLabelDraft(selectedNode?.data.label ?? "");
	}, [selectedNode?.data.label, selectedNode?.id]);

	useEffect(() => {
		setEdgeLabelDraft(typeof selectedEdge?.label === "string" ? selectedEdge.label : "");
	}, [selectedEdge?.id, selectedEdge?.label]);

	function handleNodeLabelBlur() {
		if (!selectedNode) {
			return;
		}

		const nextLabel = nodeLabelDraft.trim();

		if (nextLabel && nextLabel !== selectedNode.data.label) {
			updateNodeLabel(selectedNode.id, nextLabel);
		}
	}

	function handleNodeKindChange(kind: string) {
		if (selectedNode) {
			updateNodeKind(selectedNode.id, kind);
		}
	}

	function handleRemoveSelectedNode() {
		if (selectedNode) {
			removeNode(selectedNode.id);
		}
	}

	function handleEdgeProtocolChange(nextValue: string) {
		if (!selectedEdge) {
			return;
		}

		if (nextValue === "custom") {
			setEdgeLabelDraft(typeof selectedEdge.label === "string" ? selectedEdge.label : "");
			return;
		}

		updateEdgeLabel(selectedEdge.id, nextValue);
	}

	function handleRemoveSelectedEdge() {
		if (selectedEdge) {
			removeEdge(selectedEdge.id);
		}
	}

	useEffect(() => {
		const handleKeyboardShortcut = (event: KeyboardEvent) => {
			if (readOnly || (!event.ctrlKey && !event.metaKey)) return;
			const target = event.target as HTMLElement | null;
			if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
			if (event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) undoManager.redo();
				else undoManager.undo();
				return;
			}
			if (event.key.toLowerCase() === "y") {
				event.preventDefault();
				undoManager.redo();
			}
		};
		window.addEventListener("keydown", handleKeyboardShortcut);
		return () => window.removeEventListener("keydown", handleKeyboardShortcut);
	}, [readOnly, undoManager]);

	return (
		<div className={classNames(styles.page, hasEditorStatus && styles.withStatus)}>
			{hasEditorStatus ?
				<div className={styles.statusRow}>
					{snapshotQuery.isError ?
						<span className="muted-copy">Snapshot: {getErrorMessage(snapshotQuery.error)}</span>
					:	null}
					{updatesQuery.isError ?
						<span className="muted-copy">Updates: {getErrorMessage(updatesQuery.error)}</span>
					:	null}
					{diagramQuery.isError ?
						<span className="muted-copy">Diagram: {getErrorMessage(diagramQuery.error)}</span>
					:	null}
					{lastError ?
						<span className="form-error inline-error">{lastError}</span>
					:	null}
				</div>
			:	null}

			<div className={classNames(styles.workspace, isSidePanelCollapsed && styles.withCollapsedPanel)}>
				<DiagramCanvas
					frameRef={canvasFrameRef}
					nodes={flowNodes}
					edges={edges}
					nodeTypes={nodeTypes}
					onInit={(instance) => {
						reactFlowInstanceRef.current = instance;
					}}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					onReconnect={onReconnect}
					onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
						const selectedDiagramNodes = selectedNodes.filter((node) => !isCommentNodeId(node.id));
						const selectedDiagramNode = selectedDiagramNodes[0];
						const selectedDiagramEdge = selectedEdges[0];
						setSelectedNodeIds(selectedDiagramNodes.map((node) => node.id));

						if (selectedDiagramNode) {
							setSelectedNodeId(selectedDiagramNode.id);
							setSelectedEdgeId(null);
							return;
						}

						setSelectedNodeId(null);
						setSelectedEdgeId(selectedDiagramEdge?.id ?? null);
					}}
					onNodeDragStop={(_, node) => {
						if (isCommentNodeId(node.id)) {
							persistCommentPosition(node.id, node.position);
							return;
						}

						persistNodePosition(node.id, node.position);
					}}
					onPaneClick={(event) => {
						if (readOnly || event.detail !== 2) {
							return;
						}

						const reactFlowInstance = reactFlowInstanceRef.current;

						if (!reactFlowInstance) {
							addComment();
							return;
						}

						addComment(reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
					}}
					onPointerMove={handleEditorPointerMove}
					onPointerLeave={handleEditorPointerLeave}
					remoteCursorConnections={remoteCursorConnections}
					readOnly={readOnly}
				/>

				<DiagramEditorPanel
					isCollapsed={isSidePanelCollapsed}
					workspaceId={workspaceId}
					projectId={projectId}
					diagramId={diagramId}
					syncState={syncState}
					activeUserCount={editorUsers.length}
					nodeCount={nodes.length}
					edgeCount={edges.length}
					commentCount={comments.length}
					selectedNodeCount={selectedNodeIds.length}
					pendingUpdateCount={pendingUpdateCount}
					snapshotVersion={snapshotVersion}
					lastUpdateSeq={lastUpdateSeq}
					documentByteSize={documentByteSize}
					roundTripMs={roundTripMs}
					reconnectAttempt={reconnectAttempt}
					lastSyncedAt={lastSyncedAt}
					isSavingSnapshot={saveSnapshot.isPending}
					readOnly={readOnly}
					canUndo={canUndo}
					canRedo={canRedo}
					assessment={assessment}
					historyItems={historyQuery.data ?? []}
					isHistoryLoading={historyQuery.isLoading}
					restoringVersion={restoringVersion}
					selectedNode={selectedNode}
					nodeLabelDraft={nodeLabelDraft}
					selectedEdge={selectedEdge}
					edgeLabelDraft={edgeLabelDraft}
					selectedProtocolValue={selectedProtocolValue}
					onCollapse={() => setIsSidePanelCollapsed(true)}
					onExpand={() => setIsSidePanelCollapsed(false)}
					onAddNode={addNode}
					onAddBoundary={addBoundary}
					onAddComment={() => addComment()}
					onSaveSnapshot={(name) => {
						if (snapshotTimerRef.current) {
							window.clearTimeout(snapshotTimerRef.current);
							snapshotTimerRef.current = null;
						}
						saveSnapshot.mutate({ name, reason: "manual" });
					}}
					onUndo={() => undoManager.undo()}
					onRedo={() => undoManager.redo()}
					onDuplicateSelection={duplicateSelection}
					onAlignSelection={alignSelection}
					onAutoLayout={autoLayout}
					onFocusInsight={focusInsight}
					onRestoreSnapshot={(snapshot) => restoreSnapshot.mutate(snapshot)}
					onExport={(format) => void handleExport(format)}
					onImport={(file) => void handleImport(file)}
					onRenameNode={handleRenameNode}
					onNodeLabelDraftChange={setNodeLabelDraft}
					onNodeLabelBlur={handleNodeLabelBlur}
					onNodeKindChange={handleNodeKindChange}
					onRemoveNode={handleRemoveSelectedNode}
					onRenameEdge={handleRenameEdge}
					onEdgeProtocolChange={handleEdgeProtocolChange}
					onEdgeLabelDraftChange={setEdgeLabelDraft}
					onRemoveEdge={handleRemoveSelectedEdge}
				/>
			</div>
		</div>
	);
}
