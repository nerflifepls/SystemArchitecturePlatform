export type UserDto = {
	id: string;
	email: string;
	name: string;
	avatarUrl?: string | null;
};

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

export type AuthSessionDto = {
	user: UserDto | null;
	session?: {
		id?: string;
		expiresAt: string;
		lastSeenAt?: string;
	};
};

export type GoogleAuthRequestDto = {
	idToken: string;
};

export type WorkspaceDto = {
	id: string;
	name: string;
	role?: WorkspaceRole;
	createdAt?: string;
	updatedAt?: string;
};

export type WorkspaceMemberDto = {
	workspaceId: string;
	user: UserDto;
	role: WorkspaceRole;
	joinedAt: string;
};

export type CreateWorkspaceDto = {
	name: string;
};

export type UpdateWorkspaceDto = Partial<CreateWorkspaceDto>;

export type AddWorkspaceMemberDto = {
	email: string;
	role: Exclude<WorkspaceRole, "owner">;
};

export type UpdateWorkspaceMemberDto = {
	role: WorkspaceRole;
};

export type ProjectDto = {
	id: string;
	workspaceId: string;
	name: string;
	description?: string;
	createdAt?: string;
	updatedAt?: string;
};

export type CreateProjectDto = {
	workspaceId: string;
	name: string;
	description?: string;
};

export type UpdateProjectDto = Partial<Omit<CreateProjectDto, "workspaceId">>;

export type DiagramDto = {
	id: string;
	projectId: string;
	title: string;
	thumbnailUrl?: string | null;
	snapshotVersion?: number;
	lastUpdateSeq?: number;
	createdAt?: string;
	updatedAt?: string;
};

export type CreateDiagramDto = {
	projectId: string;
	title: string;
};

export type UpdateDiagramDto = Partial<Omit<CreateDiagramDto, "projectId">>;

export type CrdtUpdateDto = {
	seq: number;
	updateId: string;
	clientId: string;
	authorUserId: string;
	updateBase64: string;
	createdAt: string;
};

export type CrdtUpdateAckDto = {
	seq: number;
	updateId: string;
	acceptedAt: string;
};

export type CrdtSnapshotAckDto = {
	snapshotVersion: number;
	lastUpdateSeq: number;
	savedAt?: string;
};

export type PresenceCursorDto = {
	x: number;
	y: number;
};

export type PresencePayloadDto = {
	clientId?: string;
	scope?: "editor" | "overview";
	cursor?: PresenceCursorDto | null;
	selection?: string[] | null;
	activeDocId?: string | null;
	color?: string;
	name?: string;
	status?: string;
};

export type PresenceFrameDto = {
	type:
		| "ready"
		| "presence:join"
		| "presence:update"
		| "presence:leave"
		| "pong"
		| "error"
		| "presence"
		| "cursor"
		| "status";
	connectionId?: string;
	diagramId?: string;
	user?: UserDto;
	userId?: string;
	name?: string;
	email?: string;
	avatarUrl?: string | null;
	status?: string;
	color?: string;
	presence?: PresencePayloadDto;
	code?: string;
	message?: string;
	sentAt?: string;
	updatedAt?: string;
	lastSeenAt?: string;
};

export type ListResponse<T> = {
	items: T[];
	nextCursor?: string | null;
};

export type WorkspaceResponseDto = {
	workspace: WorkspaceDto;
};

export type WorkspaceMemberResponseDto = {
	member: WorkspaceMemberDto;
};

export type ProjectResponseDto = {
	project: ProjectDto;
};

export type DiagramResponseDto = {
	diagram: DiagramDto;
	sync?: {
		snapshotUrl: string;
		updatesUrl: string;
		websocketUrl: string;
	};
	role?: WorkspaceDto["role"];
};

export type CrdtUpdatesResponseDto = {
	items: CrdtUpdateDto[];
	lastUpdateSeq: number;
};
