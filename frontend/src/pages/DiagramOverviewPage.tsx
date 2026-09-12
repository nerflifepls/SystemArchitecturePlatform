import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, Circle, Database, Maximize2, Monitor, Users, Waypoints } from "lucide-react";
import { useParams } from "react-router-dom";

import { crdtApi, diagramApi } from "../api/endpoints";
import { ButtonLink, ErrorPanel, FormError, MetricGrid, PageHeader, ToolPanel } from "../components/ui";
import { useDiagramPresence } from "../hooks/useDiagramPresence";
import { getErrorMessage } from "../utils/errors";
import { getEditorConnections, getUniquePresenceUsers } from "../utils/presence";
import styles from "./DiagramOverviewPage.module.css";

function formatBytes(value: number) {
	if (value < 1024) {
		return value + " B";
	}

	return (value / 1024).toFixed(1) + " KB";
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
	const editorPath =
		"/workspaces/" + workspaceId + "/projects/" + projectId + "/diagrams/" + diagramId + "/editor";

	return (
		<div className={styles.page}>
			<PageHeader
				eyebrow="Diagram overview"
				title={diagramQuery.data?.title ?? "Diagram"}
				description="Review the saved state and live collaboration status before entering the full-screen canvas."
				actions={
					<>
						<ButtonLink to={"/workspaces/" + workspaceId + "/projects/" + projectId}>
							<ArrowLeft size={16} />
							<span>Project</span>
						</ButtonLink>
						<ButtonLink variant="primary" to={editorPath}>
							<Maximize2 size={16} />
							<span>Open editor</span>
						</ButtonLink>
					</>
				}
			/>

			{diagramQuery.isError ? <ErrorPanel>{getErrorMessage(diagramQuery.error)}</ErrorPanel> : null}

			<section className={styles.summary} aria-label="Diagram summary">
				<article><span>Snapshot</span><strong>v{diagramQuery.data?.snapshotVersion ?? 1}</strong></article>
				<article><span>Saved updates</span><strong>{diagramQuery.data?.lastUpdateSeq ?? 0}</strong></article>
				<article><span>Payload</span><strong>{snapshotPayload}</strong></article>
				<article><span>Editing now</span><strong>{editorUsers.length}</strong></article>
			</section>

			<section className={styles.canvasHandoff} aria-labelledby="canvas-ready-title">
				<div className={styles.handoffCopy}>
					<span className={styles.handoffIcon}><Waypoints size={19} /></span>
					<span className="eyebrow">Canvas ready</span>
					<h2 id="canvas-ready-title">Continue shaping the system.</h2>
					<p>The latest snapshot is ready. Enter the editor to add components, connect services, and collaborate live.</p>
					<ButtonLink variant="primary" to={editorPath}>
						<Maximize2 size={16} />
						<span>Enter the canvas</span>
					</ButtonLink>
				</div>
				<div className={styles.blueprint} aria-hidden="true">
					<span className={[styles.blueprintNode, styles.blueprintClient].join(" ")}><Monitor size={15} /></span>
					<span className={[styles.blueprintNode, styles.blueprintGateway].join(" ")}><Waypoints size={15} /></span>
					<span className={[styles.blueprintNode, styles.blueprintData].join(" ")}><Database size={15} /></span>
					<span className={[styles.blueprintEdge, styles.blueprintEdgeOne].join(" ")} />
					<span className={[styles.blueprintEdge, styles.blueprintEdgeTwo].join(" ")} />
					<span className={styles.blueprintPulse} />
				</div>
			</section>

			<div className={styles.detailsGrid}>
				<ToolPanel className={styles.detailPanel} aria-labelledby="snapshot-status-title">
					<div className={styles.panelIntro}>
						<span className={styles.panelIcon}><Circle size={16} /></span>
						<div>
							<span className="eyebrow">Persistence</span>
							<h2 id="snapshot-status-title">Snapshot status</h2>
							<p>Saved state and update sequence for this diagram.</p>
						</div>
					</div>
					<MetricGrid
						items={[
							{ label: "Version", value: diagramQuery.data?.snapshotVersion ?? 1 },
							{ label: "Last update sequence", value: diagramQuery.data?.lastUpdateSeq ?? 0 },
							{ label: "Snapshot payload", value: snapshotPayload },
							{ label: "Last saved", value: updatedAt },
						]}
					/>
					{snapshotQuery.isError ? <FormError>{getErrorMessage(snapshotQuery.error)}</FormError> : null}
				</ToolPanel>

				<ToolPanel className={styles.detailPanel} aria-labelledby="active-editors-title">
					<div className={styles.panelIntro}>
						<span className={styles.panelIcon}><Users size={17} /></span>
						<div>
							<span className="eyebrow">Live presence</span>
							<h2 id="active-editors-title">Active collaborators</h2>
							<p>People currently connected to the full-screen editor.</p>
						</div>
					</div>
					<div className={styles.presenceStatus}>
						<Activity size={15} />
						<span>Realtime status</span>
						<strong>{presence.status}</strong>
					</div>
					{presence.lastError ? <FormError>{presence.lastError}</FormError> : null}
					{editorUsers.length === 0 ?
						<div className={styles.emptyPresence}>
							<span className={styles.presenceDot} />
							<div><strong>The canvas is quiet</strong><span>No one is editing right now.</span></div>
						</div>
					: <ul className={styles.connectionList} aria-label="Active editor users">
							{editorUsers.map((connection) => (
								<li key={connection.userId ?? connection.connectionId}>
									<span className={styles.connectionColor} style={{ backgroundColor: connection.color }} />
									<span>{connection.name}</span>
								</li>
							))}
						</ul>}
				</ToolPanel>
			</div>
		</div>
	);
}
