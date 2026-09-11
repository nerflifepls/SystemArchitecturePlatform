import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { memo, useEffect, useRef, type PointerEvent } from "react";

import { classNames } from "../ui/classNames";
import styles from "./DiagramNodes.module.css";
import {
	BOUNDARY_MAX_SIZE,
	BOUNDARY_MIN_SIZE,
	COMMENT_DEFAULT_SIZE,
	clampCommentSize,
	commentSizesEqual,
	formatCommentTimestamp,
	type DiagramNodeData,
} from "./diagramEditorModel";
import { NodeKindIcon, normalizeNodeKindIconName } from "./NodeKindIcon";

function areDiagramComponentNodePropsEqual(
	previous: NodeProps<Node<DiagramNodeData, "default">>,
	next: NodeProps<Node<DiagramNodeData, "default">>,
) {
	return (
		previous.selected === next.selected &&
		previous.data.label === next.data.label &&
		previous.data.kind === next.data.kind
	);
}

function areCommentNodePropsEqual(
	previous: NodeProps<Node<DiagramNodeData, "comment">>,
	next: NodeProps<Node<DiagramNodeData, "comment">>,
) {
	return (
		previous.selected === next.selected &&
		previous.data.text === next.data.text &&
		previous.data.authorName === next.data.authorName &&
		previous.data.createdAt === next.data.createdAt &&
		previous.data.updatedAt === next.data.updatedAt &&
		previous.data.shouldFocus === next.data.shouldFocus &&
		previous.data.readOnly === next.data.readOnly &&
		commentSizesEqual(previous.data.size, next.data.size)
	);
}

function areBoundaryNodePropsEqual(
	previous: NodeProps<Node<DiagramNodeData, "boundary">>,
	next: NodeProps<Node<DiagramNodeData, "boundary">>,
) {
	return (
		previous.selected === next.selected &&
		previous.data.label === next.data.label &&
		previous.data.kind === next.data.kind &&
		previous.data.readOnly === next.data.readOnly
	);
}

export const DiagramComponentNode = memo(function DiagramComponentNode({
	data,
	selected,
}: NodeProps<Node<DiagramNodeData, "default">>) {
	const iconKind = normalizeNodeKindIconName(data.kind);

	return (
		<div
			className={classNames(styles.componentNode, selected && styles.selected)}
			data-node-kind={iconKind}
		>
			<Handle id="top" type="source" position={Position.Top} className={styles.nodeHandle} />
			<Handle id="right" type="source" position={Position.Right} className={styles.nodeHandle} />
			<Handle id="bottom" type="source" position={Position.Bottom} className={styles.nodeHandle} />
			<Handle id="left" type="source" position={Position.Left} className={styles.nodeHandle} />
			<div className={styles.nodeIdentity}>
				<span className={styles.nodeIcon} aria-hidden="true">
					<NodeKindIcon kind={data.kind} />
				</span>
				<span className={styles.nodeCopy}>
					<span className={styles.nodeKind}>{data.kind}</span>
					<strong className={styles.nodeLabel}>{data.label}</strong>
				</span>
			</div>
		</div>
	);
}, areDiagramComponentNodePropsEqual);

export const DiagramBoundaryNode = memo(function DiagramBoundaryNode({
	data,
	selected,
}: NodeProps<Node<DiagramNodeData, "boundary">>) {
	return (
		<section className={classNames(styles.boundaryNode, selected && styles.selected)}>
			<NodeResizer
				isVisible={selected && !data.readOnly}
				minWidth={BOUNDARY_MIN_SIZE.width}
				minHeight={BOUNDARY_MIN_SIZE.height}
				maxWidth={BOUNDARY_MAX_SIZE.width}
				maxHeight={BOUNDARY_MAX_SIZE.height}
				color="var(--primary-glow)"
				handleClassName={styles.boundaryResizeHandle}
				lineClassName={styles.boundaryResizeLine}
			/>
			<div className={styles.boundaryIdentity}>
				<span className={styles.boundaryIcon} aria-hidden="true">
					<NodeKindIcon kind="boundary" />
				</span>
				<span className={styles.boundaryCopy}>
					<span className={styles.boundaryKind}>{data.kind}</span>
					<strong className={styles.boundaryLabel}>{data.label}</strong>
				</span>
			</div>
		</section>
	);
}, areBoundaryNodePropsEqual);

export const CommentNode = memo(function CommentNode({
	id,
	data,
	selected,
}: NodeProps<Node<DiagramNodeData, "comment">>) {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const focusHandledRef = useRef(false);
	const size = clampCommentSize(data.size ?? COMMENT_DEFAULT_SIZE);
	const timestamp = data.updatedAt ?? data.createdAt ?? new Date().toISOString();

	function handleResizeStart(event: PointerEvent<HTMLSpanElement>) {
		if (data.readOnly) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const startX = event.clientX;
		const startY = event.clientY;
		const startWidth = size.width;
		const startHeight = size.height;

		function handlePointerMove(moveEvent: globalThis.PointerEvent) {
			data.onResize?.(
				id,
				clampCommentSize({
					width: startWidth + moveEvent.clientX - startX,
					height: startHeight + moveEvent.clientY - startY,
				}),
			);
		}

		function handlePointerUp() {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
		}

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
	}

	useEffect(() => {
		if (!data.shouldFocus) {
			focusHandledRef.current = false;
			return;
		}

		if (focusHandledRef.current) {
			return;
		}

		focusHandledRef.current = true;
		textareaRef.current?.focus();
		data.onFocusHandled?.(id);
	}, [data.onFocusHandled, data.shouldFocus, id]);

	return (
		<article
			className={classNames(styles.commentNode, selected && styles.selected)}
			style={{ width: size.width, height: size.height }}
		>
			<header className={styles.commentHeader}>
				<div>
					<strong>{data.authorName ?? "Collaborator"}</strong>
					<time dateTime={timestamp}>{formatCommentTimestamp(timestamp)}</time>
				</div>
				{!data.readOnly ?
					<button
						className={classNames("icon-button danger nodrag nopan", styles.deleteButton)}
						data-export-ignore="true"
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							data.onDelete?.(id);
						}}
						aria-label="Delete comment"
						title="Delete comment"
					>
						<Trash2 size={14} />
					</button>
				: null}
			</header>
			<textarea
				ref={textareaRef}
				className={classNames(styles.commentTextarea, "nodrag", "nopan")}
				value={data.text ?? ""}
				readOnly={data.readOnly}
				onChange={(event) => data.onTextChange?.(id, event.target.value)}
				onPointerDown={(event) => event.stopPropagation()}
				placeholder="Comment"
			/>
			{!data.readOnly ?
				<span
					className={classNames(styles.resizeHandle, "nodrag", "nopan")}
					data-export-ignore="true"
					onPointerDown={handleResizeStart}
					aria-label="Resize comment"
				/>
			: null}
		</article>
	);
}, areCommentNodePropsEqual);
