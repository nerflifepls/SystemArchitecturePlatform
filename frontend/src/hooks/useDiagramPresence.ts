import { useEffect, useMemo, useRef, useState } from "react";

import {
	buildLiveWsUrl,
	createVibrantCursorColor,
	parsePresenceFrame,
	reducePresenceConnections,
	type PresenceConnection,
} from "../utils/presence";

type PresenceStatus = "loading" | "live" | "offline" | "error";

export function useDiagramPresence(diagramId: string, scope: "overview" | "editor") {
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
			setStatus("live");
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
			if (typeof event.data !== "string") {
				return;
			}

			const frame = parsePresenceFrame(event.data);

			if (!frame) {
				return;
			}

			if (frame.type === "ready" && frame.connectionId) {
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
			setStatus("offline");
		});

		websocket.addEventListener("error", () => {
			setStatus("offline");
			setLastError("Realtime service is unavailable.");
		});

		return () => {
			websocket.close();
		};
	}, [diagramId, scope]);

	return useMemo(
		() => ({ status, lastError, connectionId, connections }),
		[connectionId, connections, lastError, status],
	);
}
