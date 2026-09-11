import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Circle, Maximize2, Users } from "lucide-react";
import { useParams } from "react-router-dom";

import { crdtApi, diagramApi } from "../api/endpoints";
import { ButtonLink, ErrorPanel, FormError, MetricGrid, PageHeader, ToolPanel } from "../components/ui";
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
	const snapshotPayload =
		snapshotQuery.data ? formatBytes(snapshotQuery.data.byteLength)
		: snapshotQuery.isPending ? "Loading"
		: "Unavailable";
	const updatedAt =
		diagramQuery.data?.updatedAt ? new Date(diagramQuery.data.updatedAt).toLocaleString() : "Not saved";

	return (
		<div className="page-stack">
			<PageHeader
				eyebrow="Diagram"
				title={diagramQuery.data?.title ?? "Diagram"}
				description="Review saved state and live collaboration before entering the canvas."
				actions={
					<>
						<ButtonLink to={`/workspaces/${workspaceId}/projects/${projectId}`}>
							<ArrowLeft size={16} />
							<span>Project</span>
						</ButtonLink>
						<ButtonLink
							variant="primary"
							to={`/workspaces/${workspaceId}/projects/${projectId}/diagrams/${diagramId}/editor`}
						>
							<Maximize2 size={16} />
							<span>Open editor</span>
						</ButtonLink>
					</>
				}
			/>

			{diagramQuery.isError ?
				<ErrorPanel>{getErrorMessage(diagramQuery.error)}</ErrorPanel>
			:	null}

			<div className="overview-grid">
				<ToolPanel className="overview-panel" aria-labelledby="snapshot-status-title">
					<div>
						<span className="section-icon">
							<Circle size={16} />
						</span>
						<h2 id="snapshot-status-title">Snapshot status</h2>
						<p className="muted-copy">Saved state and update sequence for this diagram.</p>
					</div>
					<div className="wide-metrics">
						<MetricGrid
							items={[
								{ label: "Version", value: diagramQuery.data?.snapshotVersion ?? 1 },
								{ label: "Last update sequence", value: diagramQuery.data?.lastUpdateSeq ?? 0 },
								{ label: "Snapshot payload", value: snapshotPayload },
								{ label: "Updated", value: updatedAt },
							]}
						/>
					</div>
					{snapshotQuery.isError ?
						<FormError>{getErrorMessage(snapshotQuery.error)}</FormError>
					:	null}
				</ToolPanel>

				<ToolPanel className="overview-panel" aria-labelledby="active-editors-title">
					<div>
						<span className="section-icon">
							<Users size={16} />
						</span>
						<h2 id="active-editors-title">Active editor users</h2>
						<p className="muted-copy">People currently connected to the full-screen editor.</p>
					</div>
					<div className="presence-summary">
						<div className="wide-metrics">
							<MetricGrid
								items={[
									{ label: "Users connected", value: editorUsers.length },
									{ label: "Realtime status", value: presence.status },
								]}
							/>
						</div>
						{presence.lastError ?
							<FormError>{presence.lastError}</FormError>
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
				</ToolPanel>
			</div>
		</div>
	);
}
