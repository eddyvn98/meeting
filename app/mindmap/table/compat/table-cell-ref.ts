import type { MindmapNode, MindmapTableLegacy, MindmapTableV2, TableCellId } from "@/components/features/chat/mindmap/mindmap-types";

export interface TableCellReference {
	cellId: TableCellId;
	legacyCellId: string;
	row: number;
	column: number;
	rowId?: string;
	columnId?: string;
}

export function legacyTableCellId(row: number, column: number) {
	return `${row}:${column}`;
}

export function stableTableCellId(tableId: string, row: number, column: number): TableCellId {
	return `cell:${tableId}:${row}:${column}`;
}

function axisIndex(axis: Array<{ id: string }>, id: string) {
	return axis.findIndex((entry) => entry.id === id);
}

function coordinatesFromStableId(tableId: string, cellId: string) {
	const prefix = `cell:${tableId}:`;
	if (!cellId.startsWith(prefix)) return undefined;
	const [row, column] = cellId.slice(prefix.length).split(":").map(Number);
	return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : undefined;
}

export function resolveTableCellReference(
	tableNode: Pick<MindmapNode, "id" | "table" | "tableV2">,
	requestedCellId?: string,
	row?: number,
	column?: number,
): TableCellReference | undefined {
	const v2 = tableNode.tableV2;
	const legacy = tableNode.table;
	let coordinates = row !== undefined && column !== undefined ? { row, column } : undefined;
	let cellId = requestedCellId;

	if (v2 && cellId && v2.cells[cellId]) {
		const cell = v2.cells[cellId];
		const v2Row = axisIndex(v2.rows, cell.rowId);
		const v2Column = axisIndex(v2.columns, cell.columnId);
		if (v2Row >= 0 && v2Column >= 0) coordinates = { row: v2Row, column: v2Column };
	}
	if (!coordinates && cellId && legacy?.cellNodeIds[cellId]) {
		const [legacyRow, legacyColumn] = cellId.split(":").map(Number);
		if (Number.isInteger(legacyRow) && Number.isInteger(legacyColumn)) coordinates = { row: legacyRow, column: legacyColumn };
	}
	if (!coordinates && cellId && legacy) {
		const [legacyRow, legacyColumn] = cellId.split(":").map(Number);
		if (Number.isInteger(legacyRow) && Number.isInteger(legacyColumn)
			&& legacyRow >= 0 && legacyColumn >= 0 && legacyRow < legacy.rows && legacyColumn < legacy.columns) {
			coordinates = { row: legacyRow, column: legacyColumn };
		}
	}
	if (!coordinates && cellId && v2) coordinates = coordinatesFromStableId(tableNode.id, cellId);
	if (!coordinates || coordinates.row < 0 || coordinates.column < 0) return undefined;

	const stableId = cellId && v2?.cells[cellId]
		? cellId
		: stableTableCellId(tableNode.id, coordinates.row, coordinates.column);
	const rowEntry = v2?.rows[coordinates.row];
	const columnEntry = v2?.columns[coordinates.column];
	return {
		cellId: stableId,
		legacyCellId: legacyTableCellId(coordinates.row, coordinates.column),
		row: coordinates.row,
		column: coordinates.column,
		rowId: rowEntry?.id,
		columnId: columnEntry?.id,
	};
}

export function tableCellReferenceForNode(tableNode: MindmapNode, node: MindmapNode): TableCellReference | undefined {
	const direct = resolveTableCellReference(tableNode, node.tableCellId);
	if (direct) return direct;
	const v2 = tableNode.tableV2;
	if (v2) {
		for (const [cellId, cell] of Object.entries(v2.cells)) {
			if (cell.items.some((item) => item.nodeId === node.id)) {
				return resolveTableCellReference(tableNode, cellId);
			}
		}
	}
	const legacy = tableNode.table;
	if (legacy) {
		for (const [cellId, ids] of Object.entries(legacy.cellNodeIds)) {
			if (ids.includes(node.id)) return resolveTableCellReference(tableNode, cellId);
		}
	}
	return undefined;
}

export function tableHasV1OrV2Data(tableNode: Pick<MindmapNode, "table" | "tableV2">) {
	return Boolean(tableNode.table || tableNode.tableV2);
}

export type LegacyTableRecord = MindmapTableLegacy;
export type V2TableRecord = MindmapTableV2;
