import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Radio, ShieldAlert } from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { DiagramDto, LiveEventDto, LiveEventType, WorkspaceDto, WorkspaceRole } from "../api/types";
import { buildUserEventsWsUrl } from "../utils/presence";
import { roleLabels } from "../utils/roles";
import styles from "./LiveEventsProvider.module.css";

export type LiveEventsStatus = "connecting" | "live" | "offline";

export type AccessLoss = {
	reason: "authorization_revoked" | "membership_removed" | "workspace_deleted" | "project_deleted" | "diagram_deleted";
	workspaceId: string;
	projectId?: string;
	diagramId?: string;
};

type RoleChange = {
	workspaceId: string;
	projectId?: string;
	diagramId?: string;
	role: WorkspaceRole;
};

type LiveEventsContextValue = {
	status: LiveEventsStatus;
	reconnectAttempt: number;
	accessLoss: AccessLoss | null;
	reportAccessLoss: (loss: AccessLoss) => void;
	applyRoleChange: (change: RoleChange) => void;
};

const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);
const FALLBACK_LIVE_EVENTS: LiveEventsContextValue = {
	status: "offline",
	reconnectAttempt: 0,
	accessLoss: null,
	reportAccessLoss: () => undefined,
	applyRoleChange: () => undefined,
};

const LIVE_EVENT_TYPES = new Set<LiveEventType>([
	"workspace.created",
	"workspace.updated",
	"workspace.deleted",
	"workspace.member.added",
	"workspace.member.updated",
	"workspace.member.removed",
	"project.created",
	"project.updated",
	"project.deleted",
	"diagram.created",
	"diagram.updated",
	"diagram.deleted",
	"diagram.snapshot.saved",
]);

const RESOURCE_QUERY_ROOTS = new Set(["workspaces", "workspace", "workspace-members", "projects", "project", "diagrams", "diagram"]);

function parseLiveEvent(value: string): LiveEventDto | null {
	try {
		const parsed = JSON.parse(value) as Partial<LiveEventDto>;
		if (
			parsed &&
			typeof parsed.id === "string" &&
			typeof parsed.type === "string" &&
			LIVE_EVENT_TYPES.has(parsed.type as LiveEventType)
		) {
			return parsed as LiveEventDto;
		}
	} catch {
		return null;
	}
	return null;
}

function routeIds(pathname: string) {
	const match = pathname.match(
		/^\/workspaces\/([^/]+)(?:\/projects\/([^/]+))?(?:\/diagrams\/([^/]+))?/,
	);
	return {
		workspaceId: match?.[1],
		projectId: match?.[2],
		diagramId: match?.[3],
	};
}

function accessLossCopy(loss: AccessLoss) {
	switch (loss.reason) {
		case "workspace_deleted":
			return { title: "Workspace deleted", message: "This workspace was deleted while you were viewing it." };
		case "project_deleted":
			return { title: "Project deleted", message: "This project was deleted while you were viewing it." };
		case "diagram_deleted":
			return { title: "Diagram deleted", message: "This diagram was deleted while you had it open." };
		case "authorization_revoked":
			return { title: "Access revoked", message: "You no longer have access to this diagram. Any editing controls have been disabled." };
		default:
			return { title: "Access revoked", message: "You no longer have access to this workspace. Any editing controls have been disabled." };
	}
}

export function LiveEventsProvider({ userId, children }: { userId: string; children: ReactNode }) {
	const queryClient = useQueryClient();
	const location = useLocation();
	const navigate = useNavigate();
	const pathnameRef = useRef(location.pathname);
	const [status, setStatus] = useState<LiveEventsStatus>("connecting");
	const [reconnectAttempt, setReconnectAttempt] = useState(0);
	const [accessLoss, setAccessLoss] = useState<AccessLoss | null>(null);
	const [announcement, setAnnouncement] = useState<string | null>(null);

	pathnameRef.current = location.pathname;

	useEffect(() => {
		if (!announcement) return;
		const timer = window.setTimeout(() => setAnnouncement(null), 6_000);
		return () => window.clearTimeout(timer);
	}, [announcement]);

	useEffect(() => {
		if (!accessLoss) return;
		const active = routeIds(location.pathname);
		const stillAffected =
			active.workspaceId === accessLoss.workspaceId &&
			(accessLoss.reason !== "project_deleted" || active.projectId === accessLoss.projectId) &&
			(accessLoss.reason !== "diagram_deleted" || active.diagramId === accessLoss.diagramId);
		if (!stillAffected) setAccessLoss(null);
	}, [accessLoss, location.pathname]);

	const reportAccessLoss = useCallback((loss: AccessLoss) => {
		const active = routeIds(pathnameRef.current);
		if (active.workspaceId !== loss.workspaceId) return;
		if (loss.reason === "project_deleted" && active.projectId !== loss.projectId) return;
		if (loss.reason === "diagram_deleted" && active.diagramId !== loss.diagramId) return;
		const affectedIds = new Set(
			[loss.workspaceId, loss.projectId, loss.diagramId].filter((id): id is string => Boolean(id)),
		);
		void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
		void queryClient.cancelQueries({
			predicate: (query) => query.queryKey.some((key) => typeof key === "string" && affectedIds.has(key)),
		});
		setAccessLoss(loss);
	}, [queryClient]);

	const applyRoleChange = useCallback(
		(change: RoleChange) => {
			queryClient.setQueryData<WorkspaceDto>(["workspace", change.workspaceId], (current) =>
				current ? { ...current, role: change.role } : current,
			);

			const active = routeIds(pathnameRef.current);
			if (active.workspaceId === change.workspaceId && active.diagramId) {
				queryClient.setQueryData<DiagramDto>(["diagram", active.diagramId], (current) =>
					current ? { ...current, role: change.role } : current,
				);
			}
			void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
			void queryClient.invalidateQueries({ queryKey: ["workspace", change.workspaceId] });
			void queryClient.invalidateQueries({ queryKey: ["workspace-members", change.workspaceId] });
			setAnnouncement(`Your workspace role changed to ${roleLabels[change.role]}.`);
		},
		[queryClient],
	);

	const handleEvent = useCallback(
		(event: LiveEventDto) => {
			const workspaceId = event.workspaceId;
			const projectId = event.projectId;
			const diagramId = event.diagramId;

			switch (event.type) {
				case "workspace.created":
					void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
					break;
				case "workspace.updated":
					void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
					if (workspaceId) void queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
					break;
				case "workspace.deleted":
					void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
					if (workspaceId) {
						void queryClient.cancelQueries({ predicate: (query) => query.queryKey.includes(workspaceId) });
						reportAccessLoss({ reason: "workspace_deleted", workspaceId });
					}
					break;
				case "workspace.member.added":
				case "workspace.member.updated":
				case "workspace.member.removed":
					void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
					if (workspaceId) {
						void queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] });
						void queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
					}
					if (event.subjectUserId === userId && workspaceId) {
						if (event.type === "workspace.member.removed") {
							reportAccessLoss({ reason: "membership_removed", workspaceId });
						} else if (event.role) {
							applyRoleChange({ workspaceId, role: event.role });
						}
					}
					break;
				case "project.created":
				case "project.updated":
				case "project.deleted":
					if (workspaceId) void queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
					if (projectId) void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
					if (event.type === "project.deleted" && workspaceId && projectId) {
						reportAccessLoss({ reason: "project_deleted", workspaceId, projectId });
					}
					break;
				case "diagram.created":
				case "diagram.updated":
				case "diagram.deleted":
					if (projectId) void queryClient.invalidateQueries({ queryKey: ["diagrams", projectId] });
					if (diagramId) void queryClient.invalidateQueries({ queryKey: ["diagram", diagramId] });
					if (event.type === "diagram.deleted" && workspaceId && diagramId) {
						reportAccessLoss({ reason: "diagram_deleted", workspaceId, projectId, diagramId });
					}
					break;
				case "diagram.snapshot.saved":
					if (projectId) void queryClient.invalidateQueries({ queryKey: ["diagrams", projectId] });
					if (diagramId) {
						void queryClient.invalidateQueries({ queryKey: ["diagram", diagramId] });
						void queryClient.invalidateQueries({ queryKey: ["diagram", diagramId, "snapshot"] });
						void queryClient.invalidateQueries({ queryKey: ["diagram", diagramId, "snapshots"] });
					}
					break;
			}
		},
		[applyRoleChange, queryClient, reportAccessLoss, userId],
	);

	useEffect(() => {
		let disposed = false;
		let websocket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		let heartbeatTimer: number | null = null;
		let attempts = 0;
		let lastPongAt = Date.now();

		const clearHeartbeat = () => {
			if (heartbeatTimer !== null) {
				window.clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}
		};

		const scheduleReconnect = () => {
			if (disposed || reconnectTimer !== null || !navigator.onLine) {
				setStatus("offline");
				return;
			}
			attempts += 1;
			setReconnectAttempt(attempts);
			setStatus("connecting");
			const baseDelay = Math.min(30_000, 750 * 2 ** Math.min(attempts - 1, 6));
			const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
			reconnectTimer = window.setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, delay);
		};

		const connect = () => {
			if (disposed) {
				return;
			}
			if (!navigator.onLine) {
				setStatus("offline");
				return;
			}
			if (websocket?.readyState === WebSocket.OPEN || websocket?.readyState === WebSocket.CONNECTING) {
				return;
			}

			setStatus("connecting");
			try {
				websocket = new WebSocket(buildUserEventsWsUrl());
			} catch {
				scheduleReconnect();
				return;
			}

			const currentSocket = websocket;
			currentSocket.addEventListener("open", () => {
				if (disposed || websocket !== currentSocket) return;
				attempts = 0;
				setReconnectAttempt(0);
				setStatus("live");
				lastPongAt = Date.now();
				void queryClient.invalidateQueries({
					predicate: (query) => RESOURCE_QUERY_ROOTS.has(String(query.queryKey[0] ?? "")),
				});
				clearHeartbeat();
				currentSocket.send(JSON.stringify({ type: "ping" }));
				heartbeatTimer = window.setInterval(() => {
					if (currentSocket.readyState !== WebSocket.OPEN) return;
					if (Date.now() - lastPongAt > 45_000) {
						currentSocket.close();
						return;
					}
					currentSocket.send(JSON.stringify({ type: "ping" }));
				}, 20_000);
			});

			currentSocket.addEventListener("message", (message) => {
				if (disposed || websocket !== currentSocket || typeof message.data !== "string") return;
				try {
					const frame = JSON.parse(message.data) as { type?: string };
					if (frame.type === "pong") {
						lastPongAt = Date.now();
						return;
					}
				} catch {
					return;
				}
				const event = parseLiveEvent(message.data);
				if (event) handleEvent(event);
			});

			currentSocket.addEventListener("close", () => {
				if (disposed || websocket !== currentSocket) return;
				websocket = null;
				clearHeartbeat();
				scheduleReconnect();
			});

			currentSocket.addEventListener("error", () => {
				if (websocket === currentSocket) currentSocket.close();
			});
		};

		const handleOnline = () => connect();
		const handleOffline = () => {
			setStatus("offline");
			clearHeartbeat();
			websocket?.close();
		};
		const handleVisibility = () => {
			if (document.visibilityState === "visible" && (!websocket || websocket.readyState === WebSocket.CLOSED)) connect();
		};

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		document.addEventListener("visibilitychange", handleVisibility);
		connect();

		return () => {
			disposed = true;
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
			document.removeEventListener("visibilitychange", handleVisibility);
			if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
			clearHeartbeat();
			websocket?.close();
		};
	}, [handleEvent, queryClient, userId]);

	const contextValue = useMemo(
		() => ({ status, reconnectAttempt, accessLoss, reportAccessLoss, applyRoleChange }),
		[accessLoss, applyRoleChange, reconnectAttempt, reportAccessLoss, status],
	);
	const lossCopy = accessLoss ? accessLossCopy(accessLoss) : null;

	return (
		<LiveEventsContext.Provider value={contextValue}>
			{children}
			{announcement ? <div className={styles.announcement} role="status"><Radio size={15} />{announcement}</div> : null}
			{accessLoss && lossCopy ? (
				<div className={styles.backdrop}>
					<section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="live-access-title">
						<span className={styles.icon}><ShieldAlert size={24} /></span>
						<span className={styles.eyebrow}><AlertTriangle size={14} /> Live access update</span>
						<h1 id="live-access-title">{lossCopy.title}</h1>
						<p>{lossCopy.message}</p>
						<button
							className="primary-button"
							type="button"
							onClick={() => {
								setAccessLoss(null);
								navigate("/", { replace: true });
							}}
						>
							<ArrowLeft size={16} /> Return to dashboard
						</button>
					</section>
				</div>
			) : null}
		</LiveEventsContext.Provider>
	);
}

export function useLiveEvents() {
	return useContext(LiveEventsContext) ?? FALLBACK_LIVE_EVENTS;
}
