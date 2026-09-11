import { ArrowLeft, ChevronLeft, ChevronRight, Circle, Edit3, MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import type { FormEventHandler } from "react";
import { Link } from "react-router-dom";

import { classNames } from "../ui/classNames";
import styles from "./DiagramEditorPanel.module.css";
import {
	NODE_KIND_PRESETS,
	PROTOCOL_PRESETS,
	type DiagramEdge,
	type DiagramNode,
	type SyncState,
} from "./diagramEditorModel";

type DiagramEditorPanelProps = {
	isCollapsed: boolean;
	workspaceId: string;
	projectId: string;
	diagramId: string;
	syncState: SyncState;
	activeUserCount: number;
	nodeCount: number;
	commentCount: number;
	isSavingSnapshot: boolean;
	readOnly: boolean;
	selectedNode: DiagramNode | null;
	nodeLabelDraft: string;
	selectedEdge: DiagramEdge | null;
	edgeLabelDraft: string;
	selectedProtocolValue: string;
	onCollapse: () => void;
	onExpand: () => void;
	onAddNode: () => void;
	onAddComment: () => void;
	onSaveSnapshot: () => void;
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

export function DiagramEditorPanel({
	isCollapsed,
	workspaceId,
	projectId,
	diagramId,
	syncState,
	activeUserCount,
	nodeCount,
	commentCount,
	isSavingSnapshot,
	readOnly,
	selectedNode,
	nodeLabelDraft,
	selectedEdge,
	edgeLabelDraft,
	selectedProtocolValue,
	onCollapse,
	onExpand,
	onAddNode,
	onAddComment,
	onSaveSnapshot,
	onRenameNode,
	onNodeLabelDraftChange,
	onNodeLabelBlur,
	onNodeKindChange,
	onRemoveNode,
	onRenameEdge,
	onEdgeProtocolChange,
	onEdgeLabelDraftChange,
	onRemoveEdge,
}: DiagramEditorPanelProps) {
	return (
		<aside
			className={classNames(styles.sidePanel, isCollapsed && styles.collapsed)}
			aria-label="Diagram editor tools"
		>
			{isCollapsed ?
				<button
					className={classNames("icon-button", styles.collapseButton)}
					type="button"
					onClick={onExpand}
					aria-label="Expand side panel"
					title="Expand side panel"
				>
					<ChevronLeft size={17} />
				</button>
			:	<>
					{readOnly ? <p className="muted-copy">Viewer access: this diagram is read-only.</p> : null}
					<section className={styles.section} aria-labelledby="editor-panel-status-title">
						<div className={styles.sectionHeading}>
							<div className={styles.title}>
								<Circle size={15} />
								<h2 id="editor-panel-status-title">Status</h2>
							</div>
							<button
								className={classNames("icon-button", styles.collapseButton)}
								type="button"
								onClick={onCollapse}
								aria-label="Collapse side panel"
								title="Collapse side panel"
							>
								<ChevronRight size={17} />
							</button>
						</div>
						<div className={styles.metricGrid}>
							<span>Sync</span>
							<strong className={classNames(styles.syncLabel, styles[syncState])}>{syncState}</strong>
							<span>Active users</span>
							<strong>{activeUserCount}</strong>
							<span>Nodes</span>
							<strong>{nodeCount}</strong>
							<span>Comments</span>
							<strong>{commentCount}</strong>
						</div>
						<div className={styles.actions}>
							<Link
								className="secondary-button"
								to={`/workspaces/${workspaceId}/projects/${projectId}/diagrams/${diagramId}`}
							>
								<ArrowLeft size={16} />
								<span>Details</span>
							</Link>
							<button className="secondary-button" type="button" onClick={onAddNode} disabled={readOnly}>
								<Plus size={16} />
								<span>Node</span>
							</button>
							<button className="secondary-button" type="button" onClick={onAddComment} disabled={readOnly}>
								<MessageSquare size={16} />
								<span>Comment</span>
							</button>
							<button
								className="primary-button"
								type="button"
								onClick={onSaveSnapshot}
								disabled={isSavingSnapshot || readOnly}
							>
								<Save size={16} />
								<span>Snapshot</span>
							</button>
						</div>
					</section>

					<section className={styles.section} aria-labelledby="node-inspector-title">
						<div className={styles.title}>
							<Edit3 size={15} />
							<h2 id="node-inspector-title">Node</h2>
						</div>
						{selectedNode ?
							<form className="edit-form" onSubmit={onRenameNode}>
								<label>
									<span>Name</span>
									<input
										value={nodeLabelDraft}
										disabled={readOnly}
										onChange={(event) => onNodeLabelDraftChange(event.target.value)}
										onBlur={onNodeLabelBlur}
									/>
								</label>
								<label>
									<span>Type</span>
									<select
										value={selectedNode.data.kind}
										disabled={readOnly}
										onChange={(event) => onNodeKindChange(event.target.value)}
									>
										{NODE_KIND_PRESETS.map((kind) => (
											<option key={kind} value={kind}>
												{kind}
											</option>
										))}
									</select>
								</label>
								<div className={styles.nodeMeta}>
									<span>{selectedNode.data.kind}</span>
								</div>
								<button className="secondary-button" type="submit" disabled={readOnly || !nodeLabelDraft.trim()}>
									<Save size={15} />
									<span>Save name</span>
								</button>
								<button className="secondary-button danger-button" type="button" onClick={onRemoveNode} disabled={readOnly}>
									<Trash2 size={15} />
									<span>Delete node</span>
								</button>
							</form>
						:	<div className={styles.emptyState}>Select a node to rename it.</div>}
					</section>

					<section className={styles.section} aria-labelledby="edge-inspector-title">
						<div className={styles.title}>
							<Edit3 size={15} />
							<h2 id="edge-inspector-title">Arrow</h2>
						</div>
						{selectedEdge ?
							<form className="edit-form" onSubmit={onRenameEdge}>
								<label>
									<span>Protocol</span>
									<select
										value={selectedProtocolValue}
										disabled={readOnly}
										onChange={(event) => onEdgeProtocolChange(event.target.value)}
									>
										<option value="">No label</option>
										{PROTOCOL_PRESETS.map((protocol) => (
											<option key={protocol} value={protocol}>
												{protocol}
											</option>
										))}
										<option value="custom">Custom</option>
									</select>
								</label>
								<label>
									<span>Custom label</span>
									<input
										value={edgeLabelDraft}
										disabled={readOnly}
										onChange={(event) => onEdgeLabelDraftChange(event.target.value)}
										placeholder="HTTPS, RPC, Kafka"
									/>
								</label>
								<button className="secondary-button" type="submit" disabled={readOnly}>
									<Save size={15} />
									<span>Save label</span>
								</button>
								<button className="secondary-button danger-button" type="button" onClick={onRemoveEdge} disabled={readOnly}>
									<Trash2 size={15} />
									<span>Disconnect arrow</span>
								</button>
							</form>
						:	<div className={styles.emptyState}>Select an arrow to change its label.</div>}
					</section>
				</>
			}
		</aside>
	);
}
