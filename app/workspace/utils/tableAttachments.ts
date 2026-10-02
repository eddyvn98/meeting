import { isTableBlock, resolveTransform, type BlockId, type CanvasBlock, type TableCellAttachment, type Transform } from "../types/block";

export const TABLE_CELL_ATTACHMENT_INSET = 8;
export const DEFAULT_ATTACHMENT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  w: 160,
  h: 80,
  rotation: 0,
  zIndex: 0,
};

export function tableCellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function tableCellRect(
  table: CanvasBlock<"table">,
  row: number,
  col: number,
): { x: number; y: number; width: number; height: number } | null {
  const rows = table.data?.rows;
  const cols = table.data?.cols;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return null;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;

  const rowWeights = Array.isArray(table.data?.rowWeights) && table.data.rowWeights.length === rows
    ? table.data.rowWeights
    : Array(rows).fill(1);
  const colWeights = Array.isArray(table.data?.colWeights) && table.data.colWeights.length === cols
    ? table.data.colWeights
    : Array(cols).fill(1);
  const rowSum = rowWeights.reduce((sum, value) => sum + value, 0) || 1;
  const colSum = colWeights.reduce((sum, value) => sum + value, 0) || 1;
  const transform = resolveTransform(table.transform, DEFAULT_ATTACHMENT_TRANSFORM);
  const xOffset = colWeights.slice(0, col).reduce((sum, value) => sum + value, 0) / colSum * transform.w;
  const yOffset = rowWeights.slice(0, row).reduce((sum, value) => sum + value, 0) / rowSum * transform.h;
  return {
    x: transform.x + xOffset,
    y: transform.y + yOffset,
    width: colWeights[col] / colSum * transform.w,
    height: rowWeights[row] / rowSum * transform.h,
  };
}

export function attachmentTransform(
  table: CanvasBlock<"table">,
  attachment: TableCellAttachment,
  row: number,
  col: number,
): Transform | null {
  const cell = tableCellRect(table, row, col);
  if (!cell) return null;
  return {
    ...DEFAULT_ATTACHMENT_TRANSFORM,
    x: cell.x + attachment.x,
    y: cell.y + attachment.y,
    w: attachment.width,
    h: attachment.height,
  };
}

export interface WorkspaceTableAttachmentRecord {
  table: CanvasBlock<"table">;
  cellKey: string;
  row: number;
  col: number;
  attachment: TableCellAttachment;
}

export function findTableAttachment(
  blocks: Record<BlockId, CanvasBlock>,
  blockId: BlockId,
): WorkspaceTableAttachmentRecord | null {
  for (const table of Object.values(blocks)) {
    if (!isTableBlock(table)) continue;
    for (const [cellKey, items] of Object.entries(table.data?.cellItems ?? {})) {
      const [row, col] = cellKey.split(":").map(Number);
      if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
      const attachment = items.find((item) => item.blockId === blockId);
      if (attachment) return { table, cellKey, row, col, attachment };
    }
  }
  return null;
}

export function collectAttachedBlockIds(blocks: Record<BlockId, CanvasBlock>): Set<BlockId> {
  const ids = new Set<BlockId>();
  for (const block of Object.values(blocks)) {
    if (!isTableBlock(block)) continue;
    for (const items of Object.values(block.data?.cellItems ?? {})) {
      for (const item of items) ids.add(item.blockId);
    }
  }
  return ids;
}

/** A duplicated/copied table must not keep ownership of the original blocks. */
export function withoutTableAttachments(block: CanvasBlock): CanvasBlock["data"] {
  if (!isTableBlock(block)) return block.data;
  const data = { ...block.data };
  delete data.cellItems;
  return data;
}

export function projectAttachedBlocks(
  blocks: Record<BlockId, CanvasBlock>,
): Record<BlockId, CanvasBlock> {
  const projected = { ...blocks };
  for (const block of Object.values(blocks)) {
    const record = findTableAttachment(blocks, block.id);
    if (!record) continue;
    const transform = attachmentTransform(record.table, record.attachment, record.row, record.col);
    if (!transform) continue;
    projected[block.id] = { ...block, transform: { computed: null, override: transform } };
  }
  return projected;
}

export function removeAttachmentFromTables(
  blocks: Record<BlockId, CanvasBlock>,
  blockId: BlockId,
): Record<BlockId, Record<string, TableCellAttachment[]>> {
  const changes: Record<BlockId, Record<string, TableCellAttachment[]>> = {};
  for (const table of Object.values(blocks)) {
    if (!isTableBlock(table) || !table.data?.cellItems) continue;
    const nextItems: Record<string, TableCellAttachment[]> = {};
    let changed = false;
    for (const [key, items] of Object.entries(table.data.cellItems)) {
      const next = items.filter((item) => item.blockId !== blockId);
      if (next.length !== items.length) changed = true;
      if (next.length) nextItems[key] = next;
    }
    if (changed) changes[table.id] = nextItems;
  }
  return changes;
}
