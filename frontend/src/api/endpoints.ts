import { ApiError, requestBinary, requestJson, sendBinary } from "./client";
import type {
	AuthSessionDto,
	AddWorkspaceMemberDto,
	CrdtSnapshotAckDto,
	CrdtUpdateAckDto,
	CrdtUpdatesResponseDto,
	CreateDiagramDto,
	CreateProjectDto,
	CreateWorkspaceDto,
	DiagramResponseDto,
	DiagramDto,
	DiagramSnapshotDto,
	GoogleAuthRequestDto,
	ListResponse,
	ProjectResponseDto,
	ProjectDto,
	UpdateDiagramDto,
	UpdateProjectDto,
	UpdateWorkspaceMemberDto,
	UpdateWorkspaceDto,
	UserDto,
	WorkspaceMemberDto,
	WorkspaceMemberResponseDto,
	WorkspaceResponseDto,
	WorkspaceDto,
} from "./types";

function normalizeSession(payload: AuthSessionDto | UserDto | null | undefined): AuthSessionDto {
	if (!payload) {
		return { user: null };
	}

	if ("user" in payload) {
		return payload;
	}

	return { user: payload };
}

export const authApi = {
	async me(signal?: AbortSignal) {
		try {
			const payload = await requestJson<AuthSessionDto | UserDto>("/api/v1/auth/me", { signal });
			return normalizeSession(payload);
		} catch (error) {
			if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
				return { user: null } satisfies AuthSessionDto;
			}

			throw error;
		}
	},
	async signInWithGoogle(payload: GoogleAuthRequestDto) {
		const response = await requestJson<AuthSessionDto | UserDto>("/api/v1/auth/google", {
			method: "POST",
			body: payload,
		});

		return normalizeSession(response);
	},
	signOut() {
		return requestJson<void>("/api/v1/auth/logout", { method: "POST" });
	},
};

export const workspaceApi = {
	async list(signal?: AbortSignal) {
		const response = await requestJson<ListResponse<WorkspaceDto>>("/api/v1/workspaces", { signal });
		return response.items;
	},
	async get(workspaceId: string, signal?: AbortSignal) {
		const response = await requestJson<WorkspaceResponseDto>(`/api/v1/workspaces/${workspaceId}`, { signal });
		return response.workspace;
	},
	async create(payload: CreateWorkspaceDto) {
		const response = await requestJson<WorkspaceResponseDto>("/api/v1/workspaces", {
			method: "POST",
			body: payload,
		});
		return response.workspace;
	},
	async update(workspaceId: string, payload: UpdateWorkspaceDto) {
		const response = await requestJson<WorkspaceResponseDto>(`/api/v1/workspaces/${workspaceId}`, {
			method: "PATCH",
			body: payload,
		});
		return response.workspace;
	},
	remove(workspaceId: string) {
		return requestJson<void>(`/api/v1/workspaces/${workspaceId}`, { method: "DELETE" });
	},
	async listMembers(workspaceId: string, signal?: AbortSignal) {
		const response = await requestJson<ListResponse<WorkspaceMemberDto>>(
			`/api/v1/workspaces/${workspaceId}/members`,
			{ signal },
		);
		return response.items;
	},
	async addMember(workspaceId: string, payload: AddWorkspaceMemberDto) {
		const response = await requestJson<WorkspaceMemberResponseDto>(`/api/v1/workspaces/${workspaceId}/members`, {
			method: "POST",
			body: payload,
		});
		return response.member;
	},
	async updateMember(workspaceId: string, userId: string, payload: UpdateWorkspaceMemberDto) {
		const response = await requestJson<WorkspaceMemberResponseDto>(
			`/api/v1/workspaces/${workspaceId}/members/${userId}`,
			{
				method: "PATCH",
				body: payload,
			},
		);
		return response.member;
	},
	removeMember(workspaceId: string, userId: string) {
		return requestJson<void>(`/api/v1/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" });
	},
};

export const projectApi = {
	async list(workspaceId: string, signal?: AbortSignal) {
		const response = await requestJson<ListResponse<ProjectDto>>(`/api/v1/workspaces/${workspaceId}/projects`, {
			signal,
		});
		return response.items;
	},
	async get(projectId: string, signal?: AbortSignal) {
		const response = await requestJson<ProjectResponseDto>(`/api/v1/projects/${projectId}`, { signal });
		return response.project;
	},
	async create(payload: CreateProjectDto) {
		const response = await requestJson<ProjectResponseDto>(`/api/v1/workspaces/${payload.workspaceId}/projects`, {
			method: "POST",
			body: { name: payload.name, description: payload.description },
		});
		return response.project;
	},
	async update(projectId: string, payload: UpdateProjectDto) {
		const response = await requestJson<ProjectResponseDto>(`/api/v1/projects/${projectId}`, {
			method: "PATCH",
			body: payload,
		});
		return response.project;
	},
	remove(projectId: string) {
		return requestJson<void>(`/api/v1/projects/${projectId}`, { method: "DELETE" });
	},
};

export const diagramApi = {
	async list(projectId: string, signal?: AbortSignal) {
		const response = await requestJson<ListResponse<DiagramDto>>(`/api/v1/projects/${projectId}/diagrams`, {
			signal,
		});
		return response.items;
	},
	async get(diagramId: string, signal?: AbortSignal) {
		const response = await requestJson<DiagramResponseDto>(`/api/v1/diagrams/${diagramId}`, { signal });
		return { ...response.diagram, role: response.role };
	},
	async create(payload: CreateDiagramDto) {
		const response = await requestJson<DiagramResponseDto>(`/api/v1/projects/${payload.projectId}/diagrams`, {
			method: "POST",
			body: { title: payload.title },
		});
		return response.diagram;
	},
	async update(diagramId: string, payload: UpdateDiagramDto) {
		const response = await requestJson<DiagramResponseDto>(`/api/v1/diagrams/${diagramId}`, {
			method: "PATCH",
			body: payload,
		});
		return response.diagram;
	},
	remove(diagramId: string) {
		return requestJson<void>(`/api/v1/diagrams/${diagramId}`, { method: "DELETE" });
	},
};

export const crdtApi = {
	getSnapshot(diagramId: string, signal?: AbortSignal) {
		return requestBinary(`/api/v1/diagrams/${diagramId}/snapshot`, { signal });
	},
	async listUpdates(diagramId: string, options: { signal?: AbortSignal; afterSeq?: number } = {}) {
		const params = new URLSearchParams();
		if (options.afterSeq !== undefined) {
			params.set("afterSeq", String(options.afterSeq));
		}

		const query = params.toString();
		const response = await requestJson<CrdtUpdatesResponseDto>(
			`/api/v1/diagrams/${diagramId}/updates${query ? `?${query}` : ""}`,
			{ signal: options.signal },
		);
		return response;
	},
	postUpdate(diagramId: string, update: Uint8Array, updateId: string, clientId: string) {
		return sendBinary<CrdtUpdateAckDto>(`/api/v1/diagrams/${diagramId}/updates`, update, {
			method: "POST",
			headers: { "X-Update-Id": updateId, "X-Client-Id": clientId },
		});
	},
	async listSnapshots(diagramId: string, signal?: AbortSignal) {
		const response = await requestJson<ListResponse<DiagramSnapshotDto>>(
			`/api/v1/diagrams/${diagramId}/snapshots`,
			{ signal },
		);
		return response.items;
	},
	getSnapshotVersion(diagramId: string, snapshotVersion: number, signal?: AbortSignal) {
		return requestBinary(`/api/v1/diagrams/${diagramId}/snapshots/${snapshotVersion}`, { signal });
	},
	saveSnapshot(
		diagramId: string,
		snapshot: Uint8Array,
		baseUpdateSeq: number,
		clientId: string,
		options: { name?: string; reason?: DiagramSnapshotDto["reason"] } = {},
	) {
		return sendBinary<CrdtSnapshotAckDto>(`/api/v1/diagrams/${diagramId}/snapshot`, snapshot, {
			method: "PUT",
			headers: {
				"X-Base-Update-Seq": String(baseUpdateSeq),
				"X-Client-Id": clientId,
				...(options.name ? { "X-Snapshot-Name": options.name } : {}),
				...(options.reason ? { "X-Snapshot-Reason": options.reason } : {}),
			},
		});
	},
};
