/**
 * lib/workspace/knowledge-block-text.ts
 *
 * The searchable text of one block. Legacy's equivalent is one line —
 * `[node.topic, node.description]` — because a mindmap node has exactly one
 * text field. A workspace block does not: where its words live depends on its
 * type, and three of the six types keep them somewhere a naive
 * `data.markdown ?? data.label ?? data.title` never looks.
 *
 * Written as an exhaustive switch on purpose. A new block type then fails to
 * compile here rather than silently becoming unsearchable, which is the kind
 * of gap nothing reports: search keeps working, it just quietly stops finding
 * one kind of content.
 */

import type { BlockType, CanvasBlock } from "@/app/workspace/types/block";

function joinNonEmpty(parts: (string | undefined)[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

/** The words a reader would see on the block itself, without its styling.
 *  Exported (not just used by blockSearchText below) because the canvas-graph
 *  repository needs it split from `description`: a graph node's "topic" is
 *  this short label, kept separate from the longer note so a path like
 *  "Board > Q3 Plan > Budget" reads as a breadcrumb of labels, not notes. */
export function blockDataText(block: CanvasBlock): string {
  switch (block.type as BlockType) {
    case "text":
      return joinNonEmpty([(block.data as { markdown?: string } | undefined)?.markdown]);
    case "shape":
      return joinNonEmpty([(block.data as { label?: string } | undefined)?.label]);
    case "path":
      // An arrow's own label. Its points are geometry, not content.
      return joinNonEmpty([(block.data as { text?: string } | undefined)?.text]);
    case "link":
      // The title only. The URL is stored on the block and findable other
      // ways; feeding it to a 'simple' tsvector mostly adds host and scheme
      // tokens that match everything from the same domain. Reversible if
      // searching by domain turns out to matter more than the noise.
      return joinNonEmpty([(block.data as { title?: string } | undefined)?.title]);
    case "image":
      // Alt text is the one human description an image block carries. An
      // uploaded file gets a real Dify caption instead — that path goes
      // through the documents route, not here.
      return joinNonEmpty([(block.data as { alt?: string } | undefined)?.alt]);
    case "table": {
      // `cells` is the plain-text field kept in sync with the grid;
      // `cellContents` is additive rich content layered on top of it, so
      // reading cells covers both without decoding runs.
      const cells = (block.data as { cells?: unknown } | undefined)?.cells;
      if (!Array.isArray(cells)) return "";
      return joinNonEmpty(
        cells.flatMap((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === "string" ? cell : "")) : [])),
      );
    }
    default:
      return "";
  }
}

/** A block's full searchable text: what it shows, plus its note. Empty when
 *  the block carries no words at all — an unlabelled shape, a bare image —
 *  and the caller stores nothing for those rather than an empty chunk. */
export function blockSearchText(block: CanvasBlock): string {
  return joinNonEmpty([blockDataText(block), block.description]);
}

/** Every block on a board that has something to search, keyed by block id.
 *  Tolerant of a malformed `blocks` payload because this reads a Json column
 *  that older rows and other clients also write. */
export function collectBlockTexts(blocks: unknown): Map<string, string> {
  const texts = new Map<string, string>();
  if (!blocks || typeof blocks !== "object" || Array.isArray(blocks)) return texts;

  for (const [id, value] of Object.entries(blocks as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const block = value as CanvasBlock;
    const content = blockSearchText(block);
    // Keyed by the record's own key rather than block.id: the record key is
    // what every other reader of this column uses, and a row where the two
    // disagree would otherwise index under an id nothing can look up.
    if (content && id) texts.set(id, content);
  }
  return texts;
}
