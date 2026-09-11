import {
	Background,
	ConnectionMode,
	ConnectionLineType,
	Controls,
	MiniMap,
	ReactFlow,
	ViewportPortal,
	type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MousePointer2 } from "lucide-react";
import type { CSSProperties, RefObject } from "react";

import type { PresenceConnection } from "../../utils/presence";
import { DIAGRAM_EDGE_TYPE, type DiagramEdge, type DiagramNode } from "./diagramEditorModel";
import styles from "./DiagramCanvas.module.css";

type DiagramCanvasProps = {
	frameRef: RefObject<HTMLDivElement | null>;
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	nodeTypes: ReactFlowProps<DiagramNode, DiagramEdge>["nodeTypes"];
	onInit: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onInit"]>;
	onNodesChange: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onNodesChange"]>;
	onEdgesChange: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onEdgesChange"]>;
	onConnect: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onConnect"]>;
	onReconnect: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onReconnect"]>;
	onSelectionChange: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onSelectionChange"]>;
	onNodeDragStop: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onNodeDragStop"]>;
	onPaneClick: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onPaneClick"]>;
	onPointerMove: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onPointerMove"]>;
	onPointerLeave: NonNullable<ReactFlowProps<DiagramNode, DiagramEdge>["onPointerLeave"]>;
	remoteCursorConnections: PresenceConnection[];
	readOnly: boolean;
};

export function DiagramCanvas({
	frameRef,
	nodes,
	edges,
	nodeTypes,
	onInit,
	onNodesChange,
	onEdgesChange,
	onConnect,
	onReconnect,
	onSelectionChange,
	onNodeDragStop,
	onPaneClick,
	onPointerMove,
	onPointerLeave,
	remoteCursorConnections,
	readOnly,
}: DiagramCanvasProps) {
	return (
		<div className={styles.frame} ref={frameRef}>
			<section className={styles.shell} aria-label="Diagram canvas">
				<ReactFlow
					nodes={nodes}
					edges={edges}
					connectionMode={ConnectionMode.Loose}
					connectionLineType={ConnectionLineType.SmoothStep}
					defaultEdgeOptions={{ type: DIAGRAM_EDGE_TYPE }}
					nodeTypes={nodeTypes}
					onInit={onInit}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					onReconnect={onReconnect}
					onSelectionChange={onSelectionChange}
					onNodeDragStop={onNodeDragStop}
					nodesDraggable={!readOnly}
					nodesConnectable={!readOnly}
					edgesReconnectable={!readOnly}
					onPaneClick={onPaneClick}
					onPointerMove={onPointerMove}
					onPointerLeave={onPointerLeave}
					deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
					selectionOnDrag={!readOnly}
					panOnDrag={[1, 2]}
					multiSelectionKeyCode="Shift"
					fitView
					minZoom={0.2}
					maxZoom={1.8}
				>
					<ViewportPortal>
						{remoteCursorConnections.map((connection) => {
							const cursor = connection.cursor;

							if (!cursor) {
								return null;
							}

							return (
								<div
									key={connection.connectionId}
									className={styles.remoteCursor}
									style={
										{
											"--cursor-color": connection.color,
											transform: `translate(${cursor.x}px, ${cursor.y}px)`,
										} as CSSProperties
									}
								>
									<MousePointer2 size={22} fill="var(--cursor-color)" stroke="var(--cursor-color)" />
									<span>{connection.name}</span>
								</div>
							);
						})}
					</ViewportPortal>
					<Background gap={18} color="#c8d3cf" />
					<Controls />
					<MiniMap pannable zoomable />
				</ReactFlow>
			</section>
		</div>
	);
}
