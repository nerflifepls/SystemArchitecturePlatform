import {
	Activity,
	AlertTriangle,
	ArrowLeft,
	ChevronLeft,
	ChevronRight,
	Circle,
	Copy,
	Download,
	Edit3,
	FileJson,
	History,
	LayoutGrid,
	MessageSquare,
	Plus,
	Redo2,
	Save,
	SquareDashed,
	Trash2,
	Undo2,
	Upload,
} from "lucide-react";
import { useState, type FormEvent, type FormEventHandler } from "react";
import { Link } from "react-router-dom";

import type { DiagramSnapshotDto } from "../../api/types";
import { classNames } from "../ui/classNames";
import type { ArchitectureAssessment, ArchitectureInsight } from "./architectureInsights";
import styles from "./DiagramEditorPanel.module.css";
import {
	NODE_KIND_PRESETS,
	PROTOCOL_PRESETS,
	type DiagramEdge,
	type DiagramNode,
	type SyncState,
} from "./diagramEditorModel";
import {
	countDiagramHistoryKinds,
	filterDiagramHistory,
	getDiagramSaveKind,
	type DiagramHistoryFilter,
} from "./diagramHistory";
import type { AlignmentAxis, LayoutDirection } from "./diagramLayout";

type PanelTab = "build" | "review" | "history" | "export";
type ExportFormat = "json" | "svg" | "png" | "pdf";

type DiagramEditorPanelProps = {
	isCollapsed: boolean;
	workspaceId: string;
	projectId: string;
	diagramId: string;
	syncState: SyncState;
	activeUserCount: number;
	nodeCount: number;
	edgeCount: number;
	commentCount: number;
	selectedNodeCount: number;
	pendingUpdateCount: number;
	snapshotVersion: number;
	lastUpdateSeq: number;
	documentByteSize: number;
	roundTripMs: number | null;
	reconnectAttempt: number;
	lastSyncedAt: string | null;
	isSavingSnapshot: boolean;
	readOnly: boolean;
	canUndo: boolean;
	canRedo: boolean;
	assessment: ArchitectureAssessment;
	historyItems: DiagramSnapshotDto[];
	isHistoryLoading: boolean;
	restoringVersion: number | null;
	selectedNode: DiagramNode | null;
	nodeLabelDraft: string;
	selectedEdge: DiagramEdge | null;
	edgeLabelDraft: string;
	selectedProtocolValue: string;
	onCollapse: () => void;
	onExpand: () => void;
	onAddNode: () => void;
	onAddBoundary: () => void;
	onAddComment: () => void;
	onSaveSnapshot: (name?: string) => void;
	onUndo: () => void;
	onRedo: () => void;
	onDuplicateSelection: () => void;
	onAlignSelection: (axis: AlignmentAxis) => void;
	onAutoLayout: (direction: LayoutDirection) => void;
	onFocusInsight: (insight: ArchitectureInsight) => void;
	onRestoreSnapshot: (snapshot: DiagramSnapshotDto) => void;
	onExport: (format: ExportFormat) => void;
	onImport: (file: File) => void;
	onRenameNode: FormEventHandler<HTMLFormElement>;
	onNodeLabelDraftChange: (label: string) => void;
	onNodeLabelBlur: () => void;
	onNodeKindChange: (kind: string) => void;
	onRemoveNode: () => void;
	onRenameEdge: FormEventHandler<HTMLFormElement>;
	onEdgeProtocolChange: (protocol: string) => void;
	onEdgeLabelDraftChange: (label: string) => void;
	onRemoveEdge: () => void;
};

function formatBytes(value: number) {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: string | null) {
	if (!value) return "Not yet";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function DiagramEditorPanel(props: DiagramEditorPanelProps) {
	const [activeTab, setActiveTab] = useState<PanelTab>("build");
	const [snapshotName, setSnapshotName] = useState("");
	const [historyFilter, setHistoryFilter] = useState<DiagramHistoryFilter>("all");
	const historyCounts = countDiagramHistoryKinds(props.historyItems);
	const filteredHistoryItems = filterDiagramHistory(props.historyItems, historyFilter);

	if (props.isCollapsed) {
		return (
			<aside className={classNames(styles.sidePanel, styles.collapsed)} aria-label="Diagram editor tools">
				<button className={classNames("icon-button", styles.collapseButton)} type="button" onClick={props.onExpand} aria-label="Expand side panel" title="Expand side panel">
					<ChevronLeft size={17} />
				</button>
			</aside>
		);
	}

	function handleSnapshotSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		props.onSaveSnapshot(snapshotName.trim() || undefined);
		setSnapshotName("");
	}

	return (
		<aside className={styles.sidePanel} aria-label="Diagram editor tools">
			<header className={styles.panelHeader}>
				<div>
					<span className={styles.eyebrow}>Thesis workspace</span>
					<strong>Architecture studio</strong>
				</div>
				<button className={classNames("icon-button", styles.collapseButton)} type="button" onClick={props.onCollapse} aria-label="Collapse side panel" title="Collapse side panel">
					<ChevronRight size={17} />
				</button>
			</header>

			{props.readOnly ? <p className={styles.readOnlyNotice}>Viewer access · inspection and export remain available.</p> : null}

			<nav className={styles.tabs} aria-label="Editor tool categories">
				{([
					["build", "Build"],
					["review", "Review"],
					["history", "History"],
					["export", "Export"],
				] as const).map(([tab, label]) => (
					<button key={tab} type="button" className={classNames(activeTab === tab && styles.activeTab)} onClick={() => setActiveTab(tab)} aria-pressed={activeTab === tab}>
						{label}
					</button>
				))}
			</nav>

			{activeTab === "build" ? (
				<div className={styles.tabContent}>
					<section className={styles.section} aria-labelledby="build-actions-title">
						<div className={styles.title}>
							<Plus size={15} />
							<h2 id="build-actions-title">Add & organize</h2>
						</div>
						<div className={styles.actionGrid}>
							<Link className="secondary-button" to={`/workspaces/${props.workspaceId}/projects/${props.projectId}/diagrams/${props.diagramId}`}>
								<ArrowLeft size={15} /><span>Details</span>
							</Link>
							<button className="secondary-button" type="button" onClick={props.onAddNode} disabled={props.readOnly}><Plus size={15} /><span>Node</span></button>
							<button className="secondary-button" type="button" onClick={props.onAddBoundary} disabled={props.readOnly}><SquareDashed size={15} /><span>Boundary</span></button>
							<button className="secondary-button" type="button" onClick={props.onAddComment} disabled={props.readOnly}><MessageSquare size={15} /><span>Note</span></button>
						</div>
						<div className={styles.inlineActions}>
							<button className="icon-button" type="button" onClick={props.onUndo} disabled={props.readOnly || !props.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={16} /></button>
							<button className="icon-button" type="button" onClick={props.onRedo} disabled={props.readOnly || !props.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={16} /></button>
							<span>{props.selectedNodeCount ? `${props.selectedNodeCount} selected` : "Shift or drag to multi-select"}</span>
						</div>
						<div className={styles.actionGrid}>
							<button className="secondary-button" type="button" onClick={props.onDuplicateSelection} disabled={props.readOnly || props.selectedNodeCount === 0}><Copy size={15} /><span>Duplicate</span></button>
							<button className="secondary-button" type="button" onClick={() => props.onAlignSelection("horizontal")} disabled={props.readOnly || props.selectedNodeCount < 2}><span>Align rows</span></button>
							<button className="secondary-button" type="button" onClick={() => props.onAlignSelection("vertical")} disabled={props.readOnly || props.selectedNodeCount < 2}><span>Align columns</span></button>
							<button className="secondary-button" type="button" onClick={() => props.onAutoLayout("horizontal")} disabled={props.readOnly || props.nodeCount < 2}><LayoutGrid size={15} /><span>Layout L→R</span></button>
							<button className="secondary-button" type="button" onClick={() => props.onAutoLayout("vertical")} disabled={props.readOnly || props.nodeCount < 2}><LayoutGrid size={15} /><span>Layout T→B</span></button>
						</div>
					</section>

					<section className={styles.section} aria-labelledby="node-inspector-title">
						<div className={styles.title}><Edit3 size={15} /><h2 id="node-inspector-title">Selection</h2></div>
						{props.selectedNode ? (
							<form className="edit-form" onSubmit={props.onRenameNode}>
								<label><span>Name</span><input value={props.nodeLabelDraft} disabled={props.readOnly} onChange={(event) => props.onNodeLabelDraftChange(event.target.value)} onBlur={props.onNodeLabelBlur} /></label>
								{props.selectedNode.type === "boundary" ? (
									<div className={styles.nodeMeta}><span>architecture boundary</span></div>
								) : (
									<label><span>Type</span><select value={props.selectedNode.data.kind} disabled={props.readOnly} onChange={(event) => props.onNodeKindChange(event.target.value)}>{NODE_KIND_PRESETS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
								)}
								<button className="secondary-button" type="submit" disabled={props.readOnly || !props.nodeLabelDraft.trim()}><Save size={15} /><span>Save name</span></button>
								<button className="secondary-button danger-button" type="button" onClick={props.onRemoveNode} disabled={props.readOnly}><Trash2 size={15} /><span>Delete {props.selectedNode.type === "boundary" ? "boundary" : "node"}</span></button>
							</form>
						) : <div className={styles.emptyState}>Select a node or boundary to inspect it.</div>}
					</section>

					<section className={styles.section} aria-labelledby="edge-inspector-title">
						<div className={styles.title}><Edit3 size={15} /><h2 id="edge-inspector-title">Connection</h2></div>
						{props.selectedEdge ? (
							<form className="edit-form" onSubmit={props.onRenameEdge}>
								<label><span>Protocol</span><select value={props.selectedProtocolValue} disabled={props.readOnly} onChange={(event) => props.onEdgeProtocolChange(event.target.value)}><option value="">No label</option>{PROTOCOL_PRESETS.map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}<option value="custom">Custom</option></select></label>
								<label><span>Custom label</span><input value={props.edgeLabelDraft} disabled={props.readOnly} onChange={(event) => props.onEdgeLabelDraftChange(event.target.value)} placeholder="HTTPS, RPC, Kafka" /></label>
								<button className="secondary-button" type="submit" disabled={props.readOnly}><Save size={15} /><span>Save label</span></button>
								<button className="secondary-button danger-button" type="button" onClick={props.onRemoveEdge} disabled={props.readOnly}><Trash2 size={15} /><span>Disconnect</span></button>
							</form>
						) : <div className={styles.emptyState}>Select a connection to describe its protocol.</div>}
					</section>
				</div>
			) : null}

			{activeTab === "review" ? (
				<div className={styles.tabContent}>
					<section className={styles.section} aria-labelledby="review-title">
						<div className={styles.title}><AlertTriangle size={15} /><h2 id="review-title">Architecture insights</h2></div>
						<div className={styles.scoreCard}>
							<div><strong>{props.assessment.score}</strong><span>/ 100</span></div>
							<p>{props.assessment.insights.length ? "Heuristic review · address findings before submission." : "No heuristic findings. Document your design decisions next."}</p>
						</div>
						<div className={styles.severitySummary}>
							<span className={styles.critical}>{props.assessment.criticalCount} critical</span>
							<span className={styles.warning}>{props.assessment.warningCount} warnings</span>
							<span className={styles.info}>{props.assessment.infoCount} notes</span>
						</div>
						<div className={styles.insightList}>
							{props.assessment.insights.map((insight) => (
								<button key={insight.id} className={classNames(styles.insightCard, styles[insight.severity])} type="button" onClick={() => props.onFocusInsight(insight)}>
									<span>{insight.severity}</span><strong>{insight.title}</strong><p>{insight.description}</p><small>{insight.recommendation}</small>
								</button>
							))}
							{props.assessment.insights.length === 0 ? <div className={styles.emptyState}>The current graph passes all built-in heuristics.</div> : null}
						</div>
					</section>

					<section className={styles.section} aria-labelledby="observability-title">
						<div className={styles.title}><Activity size={15} /><h2 id="observability-title">Collaboration telemetry</h2></div>
						<div className={styles.metricGrid}>
							<span>Realtime</span><strong className={classNames(styles.syncLabel, styles[props.syncState])}><Circle size={8} fill="currentColor" />{props.syncState}</strong>
							<span>Round trip</span><strong>{props.roundTripMs === null ? "—" : `${props.roundTripMs} ms`}</strong>
							<span>Active users</span><strong>{props.activeUserCount}</strong>
							<span>Queued updates</span><strong>{props.pendingUpdateCount}</strong>
							<span>Convergence</span><strong>{props.syncState === "live" && props.pendingUpdateCount === 0 ? "In sync" : "Pending"}</strong>
							<span>Snapshot</span><strong>v{props.snapshotVersion}</strong>
							<span>Update sequence</span><strong>{props.lastUpdateSeq}</strong>
							<span>Document size</span><strong>{formatBytes(props.documentByteSize)}</strong>
							<span>Reconnect attempt</span><strong>{props.reconnectAttempt || "—"}</strong>
							<span>Last durable sync</span><strong>{formatTimestamp(props.lastSyncedAt)}</strong>
							<span>Graph</span><strong>{props.nodeCount}N · {props.edgeCount}E · {props.commentCount}C</strong>
						</div>
					</section>
				</div>
			) : null}

			{activeTab === "history" ? (
				<div className={styles.tabContent}>
					<section className={styles.section} aria-labelledby="history-title">
						<div className={styles.title}><History size={15} /><h2 id="history-title">Version history</h2></div>
						<form className={styles.snapshotForm} onSubmit={handleSnapshotSubmit}>
							<label><span>Version label</span><input value={snapshotName} onChange={(event) => setSnapshotName(event.target.value)} maxLength={120} placeholder="Before evaluation run" disabled={props.readOnly} /></label>
							<button className="primary-button" type="submit" disabled={props.readOnly || props.isSavingSnapshot}><Save size={15} /><span>{props.isSavingSnapshot ? "Saving…" : "Create version"}</span></button>
						</form>
						<div className={styles.historyFilters} role="group" aria-label="Filter version history">
							{([
								["all", "All", props.historyItems.length, "Show every saved version"],
								["manual", "Manual", historyCounts.manual, "Show named versions, imports, and restores"],
								["automatic", "Automatic", historyCounts.automatic, "Show autosaves and the initial baseline"],
							] as const).map(([filter, label, count, title]) => (
								<button
									key={filter}
									type="button"
									className={classNames(historyFilter === filter && styles.activeHistoryFilter)}
									onClick={() => setHistoryFilter(filter)}
									aria-pressed={historyFilter === filter}
									aria-label={`${label}: ${count} ${count === 1 ? "version" : "versions"}`}
									title={title}
								>
									<span>{label}</span>
									<small>{count}</small>
								</button>
							))}
						</div>
						<div className={styles.historyList}>
							{filteredHistoryItems.map((snapshot) => (
								<article key={snapshot.snapshotVersion} className={styles.historyItem}>
									<div><strong>v{snapshot.snapshotVersion} · {snapshot.name || snapshot.reason}</strong><span>{snapshot.authorName} · {formatTimestamp(snapshot.createdAt)}</span><small>{getDiagramSaveKind(snapshot) === "manual" ? "Manual" : "Automatic"} · {formatBytes(snapshot.byteSize)} · seq {snapshot.baseUpdateSeq}</small></div>
									<button className="secondary-button" type="button" onClick={() => props.onRestoreSnapshot(snapshot)} disabled={props.readOnly || props.restoringVersion !== null || snapshot.snapshotVersion === props.snapshotVersion}>{props.restoringVersion === snapshot.snapshotVersion ? "Restoring…" : "Restore"}</button>
								</article>
							))}
							{props.isHistoryLoading ? <div className={styles.emptyState}>Loading version history…</div> : null}
							{!props.isHistoryLoading && props.historyItems.length === 0 ? <div className={styles.emptyState}>Create a named version to begin the audit trail.</div> : null}
							{!props.isHistoryLoading && props.historyItems.length > 0 && filteredHistoryItems.length === 0 ? <div className={styles.emptyState}>No {historyFilter} versions yet.</div> : null}
						</div>
					</section>
				</div>
			) : null}

			{activeTab === "export" ? (
				<div className={styles.tabContent}>
					<section className={styles.section} aria-labelledby="export-title">
						<div className={styles.title}><Download size={15} /><h2 id="export-title">Portable artifacts</h2></div>
						<p className={styles.helperText}>JSON is re-importable. SVG, PNG, and PDF mirror the full canvas styling, including icons, boundaries, labels, and the grid.</p>
						<div className={styles.exportGrid}>
							<button className="secondary-button" type="button" onClick={() => props.onExport("json")}><FileJson size={16} /><span>JSON</span></button>
							<button className="secondary-button" type="button" onClick={() => props.onExport("svg")}><Download size={16} /><span>SVG</span></button>
							<button className="secondary-button" type="button" onClick={() => props.onExport("png")}><Download size={16} /><span>PNG</span></button>
							<button className="secondary-button" type="button" onClick={() => props.onExport("pdf")}><Download size={16} /><span>PDF</span></button>
						</div>
						<label className={classNames("secondary-button", styles.importButton, props.readOnly && styles.disabled)}>
							<Upload size={16} /><span>Import diagram JSON</span>
							<input type="file" accept="application/json,.json" disabled={props.readOnly} onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onImport(file); event.target.value = ""; }} />
						</label>
					</section>
				</div>
			) : null}
		</aside>
	);
}
