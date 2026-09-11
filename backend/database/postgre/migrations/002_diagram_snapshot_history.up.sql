create table if not exists diagram_snapshots (
	diagram_id uuid not null references diagrams(id) on delete cascade,
	snapshot_version bigint not null,
	base_update_seq bigint not null,
	snapshot_bytes bytea not null,
	snapshot_name text null,
	reason text not null default 'automatic' check (reason in ('initial', 'automatic', 'manual', 'restore', 'import')),
	created_by uuid references users(id),
	created_at timestamptz not null default now(),
	primary key (diagram_id, snapshot_version)
);

create index if not exists idx_diagram_snapshots_diagram_version
	on diagram_snapshots (diagram_id, snapshot_version desc);

insert into diagram_snapshots (
	diagram_id,
	snapshot_version,
	base_update_seq,
	snapshot_bytes,
	snapshot_name,
	reason,
	created_by,
	created_at
)
select
	id,
	snapshot_version,
	snapshot_base_update_seq,
	snapshot_bytes,
	'Initial state',
	'initial',
	created_by,
	updated_at
from diagrams
on conflict (diagram_id, snapshot_version) do nothing;
