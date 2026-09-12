import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { WorkspaceDto } from "../api/types";
import { LiveEventsProvider, useLiveEvents } from "./LiveEventsProvider";

class MockWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: MockWebSocket[] = [];

	readonly url: string;
	readyState = MockWebSocket.CONNECTING;
	sent: string[] = [];
	private listeners = new Map<string, Set<(event: { data?: string }) => void>>();

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: (event: { data?: string }) => void) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	send(value: string) {
		this.sent.push(value);
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
	}

	emit(type: string, data?: string) {
		if (type === "open") this.readyState = MockWebSocket.OPEN;
		if (type === "close") this.readyState = MockWebSocket.CLOSED;
		for (const listener of this.listeners.get(type) ?? []) listener({ data });
	}
}

function StatusProbe() {
	const events = useLiveEvents();
	return <span data-testid="live-status">{events.status}</span>;
}

function renderProvider(queryClient: QueryClient) {
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={["/workspaces/workspace-1/projects/project-1/diagrams/diagram-1/editor"]}>
				<LiveEventsProvider userId="user-1"><StatusProbe /></LiveEventsProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("LiveEventsProvider", () => {
	beforeEach(() => {
		MockWebSocket.instances = [];
		vi.stubGlobal("WebSocket", MockWebSocket);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("opens a user-scoped socket and applies role changes immediately", () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		queryClient.setQueryData<WorkspaceDto>(["workspace", "workspace-1"], {
			id: "workspace-1",
			name: "Runtime",
			role: "editor",
		});

		renderProvider(queryClient);
		const socket = MockWebSocket.instances[0];
		expect(socket.url).toContain("scope=user");

		act(() => socket.emit("open"));
		expect(screen.getByTestId("live-status")).toHaveTextContent("live");
		expect(socket.sent).toContain(JSON.stringify({ type: "ping" }));

		act(() => socket.emit("message", JSON.stringify({
			id: "event-1",
			type: "workspace.member.updated",
			occurredAt: new Date().toISOString(),
			actorUserId: "owner-1",
			workspaceId: "workspace-1",
			subjectUserId: "user-1",
			role: "viewer",
		})));

		expect(queryClient.getQueryData<WorkspaceDto>(["workspace", "workspace-1"])?.role).toBe("viewer");
		expect(screen.getByRole("status")).toHaveTextContent("Viewer");
	});

	it("blocks an open resource when workspace membership is removed", () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		renderProvider(queryClient);
		const socket = MockWebSocket.instances[0];

		act(() => socket.emit("message", JSON.stringify({
			id: "event-2",
			type: "workspace.member.removed",
			occurredAt: new Date().toISOString(),
			actorUserId: "owner-1",
			workspaceId: "workspace-1",
			subjectUserId: "user-1",
		})));

		expect(screen.getByRole("alertdialog")).toHaveTextContent("Access revoked");
		expect(screen.getByRole("button", { name: /return to dashboard/i })).toBeEnabled();
	});

	it("retries a dropped signed-in socket with backoff", () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		renderProvider(queryClient);

		act(() => MockWebSocket.instances[0].emit("close"));
		expect(screen.getByTestId("live-status")).toHaveTextContent("connecting");
		expect(MockWebSocket.instances).toHaveLength(1);

		act(() => vi.advanceTimersByTime(750));
		expect(MockWebSocket.instances).toHaveLength(2);
	});
});
