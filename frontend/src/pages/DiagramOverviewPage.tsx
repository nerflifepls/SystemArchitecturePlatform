import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Circle, Maximize2, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { crdtApi, diagramApi } from "../api/endpoints";
import { useDiagramPresence } from "../hooks/useDiagramPresence";
import { getErrorMessage } from "../utils/errors";
import { getEditorConnections, getUniquePresenceUsers } from "../utils/presence";

function formatBytes(value: number) {
	if (value < 1024) {
		return `${value} B`;
	}

	return `${(value / 1024).toFixed(1)} KB`;
}

export function DiagramOverviewPage() {
	const { workspaceId = "", projectId = "", diagramId = "" } = useParams();
	const presence = useDiagramPresence(diagramId, "overview");
	const editorConnections = getEditorConnections(presence.connections);
	const editorUsers = getUniquePresenceUsers(editorConnections);

	const diagramQuery = useQuery({
		queryKey: ["diagram", diagramId],
		queryFn: ({ signal }) => diagramApi.get(diagramId, signal),
		enabled: Boolean(diagramId),
	});

	const snapshotQuery = useQuery({
		queryKey: ["diagram", diagramId, "snapshot"],
		queryFn: ({ signal }) => crdtApi.getSnapshot(diagramId, signal),
		enabled: Boolean(diagramId),
	});

	return (
		<div className="page-stack">
			<div className="page-heading">
				<div>
					<span className="eyebrow">Diagram</span>
					<h1>{diagramQuery.data?.title ?? "Diagram"}</h1>
				</div>
				<div className="page-actions">
					<Link className="secondary-button" to={`/workspaces/${workspaceId}/projects/${projectId}`}>
						<ArrowLeft size={16} />
						<span>Project</span>
					</Link>
					<Link
						className="primary-button"
						to={`/workspaces/${workspaceId}/projects/${projectId}/diagrams/${diagramId}/editor`}
					>
						<Maximize2 size={16} />
						<span>Open editor</span>
					</Link>
				</div>
			</div>

			{diagramQuery.isError ?
				<div className="error-panel">{getErrorMessage(diagramQuery.error)}</div>
			:	null}

			<div className="overview-grid">
				<section className="tool-panel overview-panel" aria-labelledby="snapshot-status-title">
					<div>
						<span className="section-icon">
							<Circle size={16} />
						</span>
						<h2 id="snapshot-status-title">Snapshot status</h2>
						<p className="muted-copy">Saved state and update sequence for this diagram.</p>
					</div>
					<div className="metric-grid wide-metrics">
						<span>Version</span>
						<strong>{diagramQuery.data?.snapshotVersion ?? 1}</strong>
						<span>Last update sequence</span>
						<strong>{diagramQuery.data?.lastUpdateSeq ?? 0}</strong>
						<span>Snapshot payload</span>
						<strong>
							{snapshotQuery.data ?
								formatBytes(snapshotQuery.data.byteLength)
							: snapshotQuery.isPending ?
								"Loading"
							:	"Unavailable"}
						</strong>
						<span>Updated</span>
						<strong>
							{diagramQuery.data?.updatedAt ?
								new Date(diagramQuery.data.updatedAt).toLocaleString()
							:	"Not saved"}
						</strong>
					</div>
					{snapshotQuery.isError ?
						<p className="form-error">{getErrorMessage(snapshotQuery.error)}</p>
					:	null}
				</section>

				<section className="tool-panel overview-panel" aria-labelledby="active-editors-title">
					<div>
						<span className="section-icon">
							<Users size={16} />
						</span>
						<h2 id="active-editors-title">Active editor users</h2>
						<p className="muted-copy">People currently connected to the full-screen editor.</p>
					</div>
					<div className="presence-summary">
						<div className="metric-grid wide-metrics">
							<span>Users connected</span>
							<strong>{editorUsers.length}</strong>
							<span>Realtime status</span>
							<strong>{presence.status}</strong>
						</div>
						{presence.lastError ?
							<p className="form-error">{presence.lastError}</p>
						:	null}
						{editorUsers.length === 0 ?
							<p className="muted-copy">No one is editing this diagram right now.</p>
						:	<ul className="connection-list" aria-label="Active editor users">
								{editorUsers.map((connection) => (
									<li key={connection.userId ?? connection.connectionId} className="connection-row">
										<span
											className="connection-color"
											style={{ backgroundColor: connection.color }}
										/>
										<span>{connection.name}</span>
									</li>
								))}
							</ul>
						}
					</div>
				</section>
			</div>
		</div>
	);
}
