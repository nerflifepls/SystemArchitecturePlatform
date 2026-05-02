import type { PresenceCursorDto, PresenceFrameDto, PresencePayloadDto } from "../api/types";

export type PresenceConnection = {
	connectionId: string;
	userId?: string;
	name: string;
	email?: string;
	avatarUrl?: string | null;
	scope?: PresencePayloadDto["scope"];
	cursor: PresenceCursorDto | null;
	color: string;
	status?: string;
	lastSeenAt?: string;
};

export const CURSOR_COLORS = [
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
	"#f43f5e",
	"#f97316",
	"#eab308",
	"#14b8a6",
	"#84cc16",
];

export function createVibrantCursorColor() {
	return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}

export function colorForConnection(connectionId: string) {
	let hash = 0;

	for (let index = 0; index < connectionId.length; index += 1) {
		hash = (hash * 31 + connectionId.charCodeAt(index)) >>> 0;
	}

	return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

export function buildLiveWsUrl(diagramId: string) {
	const configured = import.meta.env.VITE_LIVE_WS_URL?.trim();

	if (!configured) {
		return `ws://localhost:8080/ws?diagramId=${encodeURIComponent(diagramId)}`;
	}

	if (configured.includes("{diagramId}")) {
		return configured.replace("{diagramId}", encodeURIComponent(diagramId));
	}

	const url = new URL(configured, window.location.href);
	url.searchParams.set("diagramId", diagramId);
	return url.toString();
}

export function parsePresenceFrame(value: string) {
	try {
		const parsedValue = JSON.parse(value) as unknown;

		if (parsedValue && typeof parsedValue === "object" && "type" in parsedValue) {
			return parsedValue as PresenceFrameDto;
		}
	} catch {
		return null;
	}

	return null;
}

export function reducePresenceConnections(current: Record<string, PresenceConnection>, frame: PresenceFrameDto) {
	if (!frame.connectionId || frame.type === "ready" || frame.type === "pong" || frame.type === "error") {
		return current;
	}

	if (frame.type === "presence:leave") {
		if (!current[frame.connectionId]) {
			return current;
		}

		const next = { ...current };
		delete next[frame.connectionId];
		return next;
	}

	const existing = current[frame.connectionId];
	const payload = frame.presence;
	const hasCursor = Boolean(payload && Object.prototype.hasOwnProperty.call(payload, "cursor"));
	const name = frame.name || payload?.name || frame.user?.name || frame.userId || "Collaborator";

	return {
		...current,
		[frame.connectionId]: {
			connectionId: frame.connectionId,
			userId: frame.userId ?? frame.user?.id ?? existing?.userId,
			name,
			email: frame.email ?? frame.user?.email ?? existing?.email,
			avatarUrl: frame.avatarUrl ?? frame.user?.avatarUrl ?? existing?.avatarUrl,
			scope: payload?.scope ?? existing?.scope,
			cursor: hasCursor ? (payload?.cursor ?? null) : (existing?.cursor ?? null),
			color: payload?.color ?? frame.color ?? existing?.color ?? colorForConnection(frame.connectionId),
			status: payload?.status ?? frame.status ?? existing?.status,
			lastSeenAt: frame.sentAt ?? frame.updatedAt ?? frame.lastSeenAt ?? new Date().toISOString(),
		},
	};
}

export function getEditorConnections(connections: Record<string, PresenceConnection>) {
	return Object.values(connections).filter((connection) => connection.scope === "editor");
}

export function getUniquePresenceUsers(connections: PresenceConnection[]) {
	const users = new Map<string, PresenceConnection>();

	for (const connection of connections) {
		users.set(connection.userId ?? connection.connectionId, connection);
	}

	return Array.from(users.values());
}
