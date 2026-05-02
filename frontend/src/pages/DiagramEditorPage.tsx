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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useParams } from "react-router-dom";
import * as Y from "yjs";

import { crdtApi, diagramApi } from "../api/endpoints";
import type { CrdtUpdatesResponseDto, PresenceCursorDto } from "../api/types";
import { DiagramCanvas } from "../components/editor/DiagramCanvas";
import { DiagramEditorPanel } from "../components/editor/DiagramEditorPanel";
import { CommentNode, DiagramComponentNode } from "../components/editor/DiagramNodes";
import {
	COMMENT_DEFAULT_SIZE,
	INITIAL_UPDATE_COMPACTION_THRESHOLD,
	INIT_ORIGIN,
	LOCAL_ORIGIN,
	PROTOCOL_PRESETS,
	REMOTE_ORIGIN,
	clampCommentSize,
	commentNodeDataMatches,
	commentSizesEqual,
	encodeCompactedSnapshot,
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

export function DiagramEditorPage() {
	const { workspaceId = "", projectId = "", diagramId = "" } = useParams();
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
	const [nodes, setNodes] = useState<DiagramNode[]>([]);
	const [edges, setEdges] = useState<DiagramEdge[]>([]);
	const [comments, setComments] = useState<StoredComment[]>([]);
	const [syncState, setSyncState] = useState<SyncState>("loading");
	const [lastError, setLastError] = useState<string | null>(null);
	const [presenceConnections, setPresenceConnections] = useState<Record<string, PresenceConnection>>({});
	const [ownConnectionId, setOwnConnectionId] = useState<string | null>(null);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
	const [nodeLabelDraft, setNodeLabelDraft] = useState("");
	const [edgeLabelDraft, setEdgeLabelDraft] = useState("");
	const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
	const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false);
	const nodesRef = useRef<DiagramNode[]>([]);
	const edgesRef = useRef<DiagramEdge[]>([]);
	const commentsRef = useRef<StoredComment[]>([]);
	const commentNodeCacheRef = useRef<Map<string, DiagramNode>>(new Map());
	const canvasFrameRef = useRef<HTMLDivElement | null>(null);
	const websocketRef = useRef<WebSocket | null>(null);
	const reactFlowInstanceRef = useRef<ReactFlowInstance<DiagramNode, DiagramEdge> | null>(null);
	const snapshotTimerRef = useRef<number | null>(null);
	const persistedSyncTimerRef = useRef<number | null>(null);
	const snapshotAppliedRef = useRef(false);
	const initialUpdatesAppliedRef = useRef(false);
	const clientIdRef = useRef(crypto.randomUUID());
	const cursorColorRef = useRef(createVibrantCursorColor());
	const lastPresenceSentAtRef = useRef(0);
	const persistedUpdateSeqRef = useRef(0);
	const pendingUpdatePromisesRef = useRef<Set<Promise<void>>>(new Set());
	const persistedSyncPromiseRef = useRef<Promise<number> | null>(null);
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
	const selectedProtocolValue =
		edgeLabelDraft ?
			PROTOCOL_PRESETS.some((protocol) => protocol === edgeLabelDraft) ?
				edgeLabelDraft
			:	"custom"
		:	"";
	const nodeTypes = useMemo(() => ({ default: DiagramComponentNode, comment: CommentNode }), []);

	const sessionQuery = useSession();

	const diagramQuery = useQuery({
		queryKey: ["diagram", diagramId],
		queryFn: ({ signal }) => diagramApi.get(diagramId, signal),
		enabled: Boolean(diagramId),
		refetchOnWindowFocus: false,
	});

	const snapshotQuery = useQuery({
		queryKey: ["diagram", diagramId, "snapshot"],
		queryFn: ({ signal }) => crdtApi.getSnapshot(diagramId, signal),
		enabled: Boolean(diagramId),
		refetchOnWindowFocus: false,
	});

	const updatesQuery = useQuery({
		queryKey: ["diagram", diagramId, "updates"],
		queryFn: ({ signal }) => crdtApi.listUpdates(diagramId, { signal }),
		enabled: Boolean(diagramId),
		refetchOnWindowFocus: false,
	});

	const hasEditorStatus = snapshotQuery.isError || updatesQuery.isError || diagramQuery.isError || Boolean(lastError);
	const snapshotReady = snapshotQuery.isSuccess || snapshotQuery.isError;
	const updatesReady = updatesQuery.isSuccess || updatesQuery.isError;

	const applyPersistedUpdates = useCallback(
		(updatesResponse: CrdtUpdatesResponseDto) => {
			let latestAppliedSeq = persistedUpdateSeqRef.current;

			for (const update of updatesResponse.items) {
				const bytes = updateDtoToBytes(update);

				if (bytes.length) {
					Y.applyUpdate(doc, bytes, REMOTE_ORIGIN);
				}

				latestAppliedSeq = Math.max(latestAppliedSeq, update.seq);
			}

			persistedUpdateSeqRef.current = Math.max(persistedUpdateSeqRef.current, latestAppliedSeq);
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
			.then(applyPersistedUpdates);

		persistedSyncPromiseRef.current = syncPromise;

		try {
			return await syncPromise;
		} finally {
			if (persistedSyncPromiseRef.current === syncPromise) {
				persistedSyncPromiseRef.current = null;
			}
		}
	}, [applyPersistedUpdates, diagramId]);

	const waitForPendingUpdates = useCallback(async () => {
		const pendingUpdates = Array.from(pendingUpdatePromisesRef.current);

		if (pendingUpdates.length > 0) {
			await Promise.allSettled(pendingUpdates);
		}
	}, []);

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
					status: cursor ? "editing" : "in editor",
				},
			}),
		);
	}, []);

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
		mutationFn: async () => {
			await waitForPendingUpdates();
			const baseUpdateSeq = await syncPersistedUpdates();
			// Fresh compaction rewrites Yjs item IDs, so avoid it while another editor may still emit old-document updates.
			const shouldCompactSnapshot = editorConnections.length <= 1;
			const snapshotBytes = shouldCompactSnapshot ? encodeCompactedSnapshot(maps) : Y.encodeStateAsUpdate(doc);
			const result = await crdtApi.saveSnapshot(diagramId, snapshotBytes, baseUpdateSeq, clientIdRef.current);

			if (shouldCompactSnapshot) {
				Y.applyUpdate(doc, snapshotBytes, REMOTE_ORIGIN);
			}

			return result;
		},
		onMutate: () => setSyncState("saving"),
		onSuccess: () => setSyncState(websocketRef.current?.readyState === WebSocket.OPEN ? "live" : "offline"),
		onError: (error) => {
			setLastError(getErrorMessage(error));
			setSyncState("error");
		},
	});

	const syncFromSharedMaps = useCallback(() => {
		const nextNodes = Array.from(maps.nodes.values()).map(toFlowNode);
		const nextEdges = Array.from(maps.edges.values()).map(toFlowEdge);
		const nextComments = sortComments(Array.from(maps.comments.values()));

		nodesRef.current = nextNodes;
		edgesRef.current = nextEdges;
		commentsRef.current = nextComments;
		setNodes(nextNodes);
		setEdges(nextEdges);
		setComments(nextComments);
	}, [maps.comments, maps.edges, maps.nodes]);

	const scheduleSnapshotSave = useCallback(() => {
		if (snapshotTimerRef.current) {
			window.clearTimeout(snapshotTimerRef.current);
		}

		snapshotTimerRef.current = window.setTimeout(() => {
			saveSnapshot.mutate();
		}, 1400);
	}, [saveSnapshot]);

	useEffect(() => {
		const nodeObserver = (event: Y.YMapEvent<StoredNode>) => {
			if (event.transaction.origin === LOCAL_ORIGIN) {
				return;
			}

			syncFromSharedMaps();
		};
		const edgeObserver = (event: Y.YMapEvent<StoredEdge>) => {
			if (event.transaction.origin === LOCAL_ORIGIN) {
				return;
			}

			syncFromSharedMaps();
		};
		const commentObserver = (event: Y.YMapEvent<StoredComment>) => {
			if (event.transaction.origin === LOCAL_ORIGIN) {
				return;
			}

			syncFromSharedMaps();
		};

		maps.nodes.observe(nodeObserver);
		maps.edges.observe(edgeObserver);
		maps.comments.observe(commentObserver);

		return () => {
			maps.nodes.unobserve(nodeObserver);
			maps.edges.unobserve(edgeObserver);
			maps.comments.unobserve(commentObserver);
		};
	}, [maps.comments, maps.edges, maps.nodes, syncFromSharedMaps]);

	useEffect(() => {
		snapshotAppliedRef.current = false;
		initialUpdatesAppliedRef.current = false;
		persistedUpdateSeqRef.current = 0;
	}, [diagramId]);

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
		if (initialUpdatesAppliedRef.current || !snapshotReady || !updatesReady) {
			return;
		}

		initialUpdatesAppliedRef.current = true;

		for (const update of updatesQuery.data?.items ?? []) {
			const bytes = updateDtoToBytes(update);

			if (bytes.length) {
				Y.applyUpdate(doc, bytes, INIT_ORIGIN);
			}
		}

		persistedUpdateSeqRef.current = Math.max(persistedUpdateSeqRef.current, updatesQuery.data?.lastUpdateSeq ?? 0);

		if (maps.nodes.size === 0) {
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
		setSyncState("live");

		if ((updatesQuery.data?.items.length ?? 0) >= INITIAL_UPDATE_COMPACTION_THRESHOLD) {
			scheduleSnapshotSave();
		}
	}, [
		doc,
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

			if (websocketRef.current?.readyState === WebSocket.OPEN) {
				websocketRef.current.send(toArrayBuffer(update));
			}

			const persistUpdatePromise = crdtApi
				.postUpdate(diagramId, update, crypto.randomUUID(), clientIdRef.current)
				.then((ack) => {
					if (ack.seq <= persistedUpdateSeqRef.current + 1) {
						persistedUpdateSeqRef.current = Math.max(persistedUpdateSeqRef.current, ack.seq);
						return;
					}

					void syncPersistedUpdates().catch((error: unknown) => {
						setLastError(getErrorMessage(error));
						setSyncState("error");
					});
				})
				.catch((error: unknown) => {
					setLastError(getErrorMessage(error));
					setSyncState("error");
				});

			pendingUpdatePromisesRef.current.add(persistUpdatePromise);
			void persistUpdatePromise.finally(() => {
				pendingUpdatePromisesRef.current.delete(persistUpdatePromise);
			});

			scheduleSnapshotSave();
		};

		doc.on("update", handleUpdate);

		return () => {
			doc.off("update", handleUpdate);
		};
	}, [diagramId, doc, scheduleSnapshotSave, syncPersistedUpdates]);

	useEffect(() => {
		if (!diagramId) {
			return;
		}

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
		setOwnConnectionId(null);
		setPresenceConnections({});

		websocket.addEventListener("open", () => {
			setSyncState("live");
			setLastError(null);
			sendPresenceUpdate(null, true);
		});

		websocket.addEventListener("message", (event) => {
			if (typeof event.data === "string") {
				const frame = parsePresenceFrame(event.data);

				if (!frame) {
					return;
				}

				if (frame.type === "ready" && frame.connectionId) {
					setOwnConnectionId(frame.connectionId);
					return;
				}

				if (frame.type === "error") {
					setLastError(frame.message ?? "Realtime service returned an error.");
					setSyncState("error");
					return;
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
					Y.applyUpdate(doc, new Uint8Array(buffer), REMOTE_ORIGIN);
					schedulePersistedSync();
				});
			}
		});

		websocket.addEventListener("close", () => {
			setSyncState("offline");
		});

		websocket.addEventListener("error", () => {
			setLastError("Realtime service is unavailable.");
			setSyncState("offline");
		});

		return () => {
			sendPresenceUpdate(null, true);
			websocket.close();
			websocketRef.current = null;
		};
	}, [diagramId, doc, schedulePersistedSync, sendPresenceUpdate]);

	useEffect(() => {
		return () => {
			if (snapshotTimerRef.current) {
				window.clearTimeout(snapshotTimerRef.current);
			}

			if (persistedSyncTimerRef.current) {
				window.clearTimeout(persistedSyncTimerRef.current);
			}
		};
	}, []);

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

				for (const change of snappedRegularChanges) {
					switch (change.type) {
						case "add":
							changedNodeIds.add(change.item.id);
							break;
						case "position":
							if (change.position) {
								if (change.dragging !== true) {
									changedNodeIds.add(change.id);
								}
							}
							break;
						case "remove":
							removedNodeIds.add(change.id);
							break;
						case "replace":
							removedNodeIds.add(change.id);
							changedNodeIds.add(change.item.id);
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
					setSelectedEdgeId((currentEdgeId) =>
						currentEdgeId && removedEdgeIds.has(currentEdgeId) ? null : currentEdgeId,
					);
				}

				if (changedNodeIds.size > 0 || removedNodeIds.size > 0) {
					doc.transact(() => {
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
					}, LOCAL_ORIGIN);
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
			let nextComments = commentsRef.current;

			for (const change of commentChanges) {
				switch (change.type) {
					case "position":
						if (change.position) {
							commentsChanged = true;
							nextComments = nextComments.map((comment) =>
								comment.id === change.id ? { ...comment, position: change.position } : comment,
							);
						}
						break;
					case "remove":
						commentsChanged = true;
						removedCommentIds.add(change.id);
						break;
					case "replace":
						commentsChanged = true;
						changedCommentIds.add(change.item.id);
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

			doc.transact(() => {
				for (const commentId of removedCommentIds) {
					maps.comments.delete(commentId);
				}

				for (const comment of nextComments) {
					if (changedCommentIds.has(comment.id)) {
						maps.comments.set(comment.id, comment);
					}
				}
			}, LOCAL_ORIGIN);
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
				type: "smoothstep",
				label: "HTTPS",
			};

			const nextEdges = addEdge(edge, edgesRef.current);

			edgesRef.current = nextEdges;
			setEdges(nextEdges);

			doc.transact(() => {
				maps.edges.set(edge.id, toStoredEdge(edge));
			}, LOCAL_ORIGIN);
			setSelectedNodeId(null);
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
		const nextNodes = [...nodesRef.current, toFlowNode(node)];

		nodesRef.current = nextNodes;
		setNodes(nextNodes);

		doc.transact(() => {
			maps.nodes.set(node.id, node);
		}, LOCAL_ORIGIN);
		setSelectedNodeId(node.id);
	}

	function getCommentStartPosition() {
		const reactFlowInstance = reactFlowInstanceRef.current;
		const canvasBounds = canvasFrameRef.current?.getBoundingClientRect();

		if (reactFlowInstance && canvasBounds) {
			return reactFlowInstance.screenToFlowPosition({
				x: canvasBounds.left + canvasBounds.width / 2,
				y: canvasBounds.top + canvasBounds.height / 2,
			});
		}

		return getFallbackCommentPosition(commentsRef.current.length);
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

	const flowNodes = useMemo(() => {
		const previousCommentNodes = commentNodeCacheRef.current;
		const nextCommentNodes = new Map<string, DiagramNode>();
		const commentFlowNodes = comments.map((comment, index) => {
			const previousNode = previousCommentNodes.get(comment.id);
			const position = comment.position ?? getFallbackCommentPosition(index);
			const size = comment.size ?? COMMENT_DEFAULT_SIZE;
			const shouldFocus = focusedCommentId === comment.id;
			const data =
				previousNode && commentNodeDataMatches(previousNode.data, comment, size, shouldFocus) ?
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
	}, [clearFocusedComment, comments, focusedCommentId, nodes, removeComment, updateCommentSize, updateCommentText]);

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
						const selectedDiagramNode = selectedNodes.find((node) => !isCommentNodeId(node.id));
						const selectedDiagramEdge = selectedEdges[0];

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
						if (event.detail !== 2) {
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
				/>

				<DiagramEditorPanel
					isCollapsed={isSidePanelCollapsed}
					workspaceId={workspaceId}
					projectId={projectId}
					diagramId={diagramId}
					syncState={syncState}
					activeUserCount={editorUsers.length}
					nodeCount={nodes.length}
					commentCount={comments.length}
					isSavingSnapshot={saveSnapshot.isPending}
					selectedNode={selectedNode}
					nodeLabelDraft={nodeLabelDraft}
					selectedEdge={selectedEdge}
					edgeLabelDraft={edgeLabelDraft}
					selectedProtocolValue={selectedProtocolValue}
					onCollapse={() => setIsSidePanelCollapsed(true)}
					onExpand={() => setIsSidePanelCollapsed(false)}
					onAddNode={addNode}
					onAddComment={() => addComment()}
					onSaveSnapshot={() => saveSnapshot.mutate()}
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
