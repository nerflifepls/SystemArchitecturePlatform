import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { DiagramSnapshotDto } from "../../api/types";
import { analyzeArchitecture } from "./architectureInsights";
import { DiagramEditorPanel } from "./DiagramEditorPanel";

function historyItem(snapshotVersion: number, reason: DiagramSnapshotDto["reason"], name: string): DiagramSnapshotDto {
	return {
		diagramId: "diagram-1",
		snapshotVersion,
		baseUpdateSeq: snapshotVersion * 2,
		byteSize: 512,
		name,
		reason,
		createdBy: "user-1",
		authorName: "Researcher",
		createdAt: "2026-09-12T10:00:00.000Z",
	};
}

describe("DiagramEditorPanel history", () => {
	afterEach(cleanup);

	it("filters version history between manual and automatic saves", async () => {
		const user = userEvent.setup();
		render(
			<MemoryRouter>
				<DiagramEditorPanel
					isCollapsed={false}
					workspaceId="workspace-1"
					projectId="project-1"
					diagramId="diagram-1"
					syncState="live"
					activeUserCount={1}
					nodeCount={2}
					edgeCount={1}
					commentCount={0}
					selectedNodeCount={0}
					pendingUpdateCount={0}
					snapshotVersion={3}
					lastUpdateSeq={6}
					documentByteSize={1024}
					roundTripMs={12}
					reconnectAttempt={0}
					lastSyncedAt="2026-09-12T10:00:00.000Z"
					isSavingSnapshot={false}
					readOnly={false}
					canUndo={false}
					canRedo={false}
					assessment={analyzeArchitecture([], [])}
					historyItems={[
						historyItem(3, "automatic", "Autosave"),
						historyItem(2, "import", "Imported baseline"),
						historyItem(1, "manual", "Thesis milestone"),
					]}
					isHistoryLoading={false}
					restoringVersion={null}
					selectedNode={null}
					nodeLabelDraft=""
					selectedEdge={null}
					edgeLabelDraft=""
					selectedProtocolValue=""
					onCollapse={vi.fn()}
					onExpand={vi.fn()}
					onAddNode={vi.fn()}
					onAddBoundary={vi.fn()}
					onAddComment={vi.fn()}
					onSaveSnapshot={vi.fn()}
					onUndo={vi.fn()}
					onRedo={vi.fn()}
					onDuplicateSelection={vi.fn()}
					onAlignSelection={vi.fn()}
					onAutoLayout={vi.fn()}
					onFocusInsight={vi.fn()}
					onRestoreSnapshot={vi.fn()}
					onExport={vi.fn()}
					onImport={vi.fn()}
					onRenameNode={vi.fn()}
					onNodeLabelDraftChange={vi.fn()}
					onNodeLabelBlur={vi.fn()}
					onNodeKindChange={vi.fn()}
					onRemoveNode={vi.fn()}
					onRenameEdge={vi.fn()}
					onEdgeProtocolChange={vi.fn()}
					onEdgeLabelDraftChange={vi.fn()}
					onRemoveEdge={vi.fn()}
				/>
			</MemoryRouter>,
		);

		await user.click(screen.getByRole("button", { name: "History" }));
		expect(screen.getByRole("button", { name: "All: 3 versions" })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByText(/Autosave/)).toBeInTheDocument();
		expect(screen.getByText(/Imported baseline/)).toBeInTheDocument();
		expect(screen.getByText(/Thesis milestone/)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Manual: 2 versions" }));
		expect(screen.queryByText(/Autosave/)).not.toBeInTheDocument();
		expect(screen.getByText(/Imported baseline/)).toBeInTheDocument();
		expect(screen.getByText(/Thesis milestone/)).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "Automatic: 1 version" }));
		expect(screen.getByText(/Autosave/)).toBeInTheDocument();
		expect(screen.queryByText(/Imported baseline/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Thesis milestone/)).not.toBeInTheDocument();
	});
});
