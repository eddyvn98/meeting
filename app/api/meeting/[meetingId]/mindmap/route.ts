import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveMeetingCallerEmail } from "../../_auth";
import { resolveMeetingAccess } from "../../_access";
import { serializeMeetingSummary } from "@/lib/meeting/serialize";
import { generateMeetingMindmap, buildFallbackMindmapOutline, type MindmapOutlineNode } from "@/lib/meeting/ai/generateMeetingMindmap";
import { buildTreeTemplateBlocks, type TemplateNode } from "@/app/workspace/utils/templates/workspaceDiagramTemplates";
import type { MapLayoutSettings } from "@/app/workspace/types/block";
import { DEFAULT_CAMERA } from "@/app/workspace/types/camera";
import { commitBoardContent } from "@/lib/workspace/boardCommit";
import { createWorkspaceId } from "@/app/workspace/utils/workspaceId";

const MINDMAP_LAYOUT: MapLayoutSettings = {
  family: "hierarchy",
  direction: "right",
  growthMode: "one-side",
  connectorLineType: "curved",
  connectorPaletteId: "default",
  timelineBranchMode: "auto",
  timelineDescendantStyle: "tree",
  catalogDescendantStyle: "tree",
};

/** Same root/branch palette as the Workspace "blank map" seed
 *  (defaultTemplate in workspaceDiagramTemplates.ts) — a meeting-generated
 *  map should look like any other freshly created one, not stand out as a
 *  special case. */
function toTemplateNode(outline: MindmapOutlineNode, depth: number): TemplateNode {
  const rootStyle = { shapeKind: "rounded" as const, backgroundColor: "#ffffff", borderColor: "#3370ff", borderWidth: 1.5 as const, textColor: "#0f172a" };
  const branchStyle = { shapeKind: "rounded" as const, backgroundColor: "#3370ff15", borderColor: "#3370ff", borderWidth: 1.5 as const, textColor: "#0f172a" };
  return {
    label: outline.label,
    style: depth === 0 ? rootStyle : branchStyle,
    children: outline.children?.map((child) => toTemplateNode(child, depth + 1)),
  };
}

/** POST /api/meeting/[meetingId]/mindmap — generates a mindmap outline from
 *  this meeting's AI summary and creates a Workspace board from it, ready to
 *  open in a new tab (see MeetingResultHeader's "Create mindmap"/"View
 *  mindmap" button). Owner or an active share grant, same access rule as
 *  GET .../[meetingId]. Requires a summary to already exist — the button is
 *  hidden client-side until then, but this is re-checked here since the
 *  route can be called directly.
 *
 *  Idempotent per meeting: once `meeting.mindmapBoardId` is set, later calls
 *  (a second "Create mindmap" click, since MeetingResultHeader always POSTs
 *  when it doesn't know a board already exists — e.g. a fresh page load)
 *  just return that same board instead of generating a new one every time. */
export async function POST(req: NextRequest, { params }: { params: { meetingId: string } }) {
  const email = await resolveMeetingCallerEmail(req);
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const meeting = await prisma.meeting.findUnique({ where: { id: params.meetingId } });
  const accessRole = meeting ? await resolveMeetingAccess(meeting, email) : null;
  if (!meeting || !accessRole) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (meeting.mindmapBoardId) {
    const existingBoard = await prisma.workspaceBoard.findUnique({ where: { id: meeting.mindmapBoardId } });
    if (existingBoard) return NextResponse.json({ boardId: existingBoard.id, title: existingBoard.title });
    // The board was deleted out from under this meeting — fall through and
    // generate a fresh one rather than returning a dead link.
  }

  const summaryRow = await prisma.meetingSummary.findUnique({
    where: { meetingId: meeting.id },
    include: { topics: true, decisions: true, actionItems: true, blockers: true, openQuestions: true, sections: { orderBy: { order: "asc" } } },
  });
  if (!summaryRow) return NextResponse.json({ error: "This meeting has no summary yet" }, { status: 400 });
  const summary = serializeMeetingSummary(summaryRow);

  const outline =
    (await generateMeetingMindmap({ meetingTitle: meeting.title, summary, callerEmail: email })) ??
    buildFallbackMindmapOutline(meeting.title, summary);

  const boardId = createWorkspaceId();
  const built = buildTreeTemplateBlocks(toTemplateNode(outline, 0), { mapId: boardId, layout: MINDMAP_LAYOUT });
  const root = built.blocks.find((block) => block.id === built.rootId);
  if (root) root.mapLayout = MINDMAP_LAYOUT;

  // useWorkspaceStore keeps blocks/connectors as Record<id, T> (see
  // app/workspace/store/useWorkspaceStore.ts), not arrays — every other board
  // is built that way client-side through the store's own actions. This is
  // the one path that writes a board's content directly from the server, so
  // buildTreeTemplateBlocks's array output has to be keyed by id itself
  // before persisting, or the client looks up `blocks[id]` on an array and
  // renders nothing despite the board genuinely holding N blocks.
  const blocksById = Object.fromEntries(built.blocks.map((b) => [b.id, b]));
  const connectorsById = Object.fromEntries(built.connectors.map((c) => [c.id, c]));

  const outcome = await commitBoardContent({
    boardId,
    actorEmail: email,
    content: {
      title: meeting.title,
      blocks: blocksById as unknown as Prisma.InputJsonValue,
      blockOrder: built.blocks.map((b) => b.id) as unknown as Prisma.InputJsonValue,
      connectors: connectorsById as unknown as Prisma.InputJsonValue,
      camera: DEFAULT_CAMERA as unknown as Prisma.InputJsonValue,
    },
    editEvents: [],
    baseRevision: null,
    existing: null,
  });

  if ("gone" in outcome || "stale" in outcome) {
    return NextResponse.json({ error: "Failed to create mindmap board" }, { status: 500 });
  }

  await prisma.meeting.update({ where: { id: meeting.id }, data: { mindmapBoardId: outcome.board.id } });

  return NextResponse.json({ boardId: outcome.board.id, title: outcome.board.title });
}
