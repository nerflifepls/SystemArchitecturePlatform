import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DiagramDto } from "../api/types";
import { useLiveEvents } from "../live/LiveEventsProvider";
import {
	buildLiveWsUrl,
	createVibrantCursorColor,
	parsePresenceFrame,
	reducePresenceConnections,
	type PresenceConnection,
} from "../utils/presence";

type PresenceStatus = "loading" | "live" | "offline" | "error";

export function useDiagramPresence(diagramId: string, scope: "overview" | "editor") {
	const queryClient = useQueryClient();
	const { applyRoleChange, reportAccessLoss } = useLiveEvents();
	const clientIdRef = useRef(crypto.randomUUID());
	const cursorColorRef = useRef(createVibrantCursorColor());
	const [status, setStatus] = useState<PresenceStatus>("loading");
	const [lastError, setLastError] = useState<string | null>(null);
	const [connectionId, setConnectionId] = useState<string | null>(null);
	const [connections, setConnections] = useState<Record<string, PresenceConnection>>({});

	useEffect(() => {
		if (!diagramId) {
			return;
		}

		let isCurrent = true;
		let websocket: WebSocket;

		try {
			websocket = new WebSocket(buildLiveWsUrl(diagramId));
		} catch {
			setStatus("error");
			setLastError("Realtime service URL is invalid.");
			return;
		}

		setStatus("loading");
		setLastError(null);
		setConnectionId(null);
		setConnections({});

		websocket.addEventListener("open", () => {
			if (!isCurrent) {
				return;
			}

			setStatus("live");
			setLastError(null);
			websocket.send(
				JSON.stringify({
					type: "presence:update",
					presence: {
						clientId: clientIdRef.current,
						scope,
						cursor: null,
						selection: null,
						activeDocId: null,
						color: cursorColorRef.current,
						status: scope === "editor" ? "editing" : "viewing",
					},
				}),
			);
		});

		websocket.addEventListener("message", (event) => {
			if (!isCurrent) {
				return;
			}

			if (typeof event.data !== "string") {
				return;
			}

			const frame = parsePresenceFrame(event.data);

			if (!frame) {
				return;
			}

			if (frame.type === "access:changed" && frame.role && frame.workspaceId) {
				applyRoleChange({
					workspaceId: frame.workspaceId,
					projectId: frame.projectId,
					diagramId: frame.diagramId ?? diagramId,
					role: frame.role,
				});
				return;
			}

			if (frame.type === "access:revoked" && frame.workspaceId) {
				const reason =
					frame.reason === "workspace_deleted" ||
					frame.reason === "project_deleted" ||
					frame.reason === "diagram_deleted" ||
					frame.reason === "authorization_revoked" ?
						frame.reason
					: "membership_removed";
				reportAccessLoss({
					reason,
					workspaceId: frame.workspaceId,
					projectId: frame.projectId,
					diagramId: frame.diagramId ?? diagramId,
				});
				return;
			}

			if (frame.type === "ready" && frame.connectionId) {
				if (frame.role) {
					queryClient.setQueryData<DiagramDto>(["diagram", diagramId], (current) =>
						current ? { ...current, role: frame.role } : current,
					);
				}
				setConnectionId(frame.connectionId);
				return;
			}

			if (frame.type === "error") {
				setLastError(frame.message ?? "Realtime service returned an error.");
				setStatus("error");
				return;
			}

			setConnections((current) => reducePresenceConnections(current, frame));
		});

		websocket.addEventListener("close", () => {
			if (!isCurrent) {
				return;
			}

			setStatus("offline");
		});

		websocket.addEventListener("error", () => {
			if (!isCurrent) {
				return;
			}

			setStatus("offline");
			setLastError("Realtime service is unavailable.");
		});

		return () => {
			isCurrent = false;
			websocket.close();
		};
	}, [applyRoleChange, diagramId, queryClient, reportAccessLoss, scope]);

	return useMemo(
		() => ({ status, lastError, connectionId, connections }),
		[connectionId, connections, lastError, status],
	);
}
