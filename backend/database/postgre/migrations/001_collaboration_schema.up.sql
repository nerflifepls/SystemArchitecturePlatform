create table if not exists users (
	id uuid primary key,
	google_sub text unique not null,
	email text unique not null,
	email_verified boolean not null default true,
	display_name text not null,
	avatar_url text null,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	last_login_at timestamptz null
);

create table if not exists workspaces (
	id uuid primary key,
	name text not null,
	created_by uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
	workspace_id uuid not null references workspaces(id) on delete cascade,
	user_id uuid not null references users(id) on delete cascade,
	role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
	joined_at timestamptz not null default now(),
	primary key (workspace_id, user_id)
);

create index if not exists idx_workspace_members_user_workspace on workspace_members (user_id, workspace_id);

create table if not exists projects (
	id uuid primary key,
	workspace_id uuid not null references workspaces(id) on delete cascade,
	name text not null,
	description text null,
	created_by uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists idx_projects_workspace_updated on projects (workspace_id, updated_at desc);

create table if not exists diagrams (
	id uuid primary key,
	project_id uuid not null references projects(id) on delete cascade,
	title text not null,
	snapshot_bytes bytea not null,
	snapshot_version bigint not null default 1,
	snapshot_base_update_seq bigint not null default 0,
	last_update_seq bigint not null default 0,
	thumbnail_url text null,
	created_by uuid references users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists idx_diagrams_project_updated on diagrams (project_id, updated_at desc);

create table if not exists diagram_updates (
	diagram_id uuid not null references diagrams(id) on delete cascade,
	seq bigint not null,
	update_id uuid not null,
	client_id text not null,
	author_user_id uuid references users(id),
	update_bytes bytea not null,
	created_at timestamptz not null default now(),
	primary key (diagram_id, seq),
	unique (diagram_id, update_id)
);

create index if not exists idx_diagram_updates_created on diagram_updates (diagram_id, created_at desc);