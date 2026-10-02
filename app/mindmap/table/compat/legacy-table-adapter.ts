import type {
	MindmapNode,
	MindmapTableV2,
	TableCellContent,
	TableCellItem,
	TableCellId,
} from "@/components/features/chat/mindmap/mindmap-types";
import { legacyTableCellId, stableTableCellId } from "./table-cell-ref";

const MAX_AXIS = 100;
const DEFAULT_TABLE_WIDTH = 480;
const DEFAULT_TABLE_HEIGHT = 300;

export interface TableMigrationResult {
	table: MindmapTableV2;
	source: "legacy" | "v2";
	contentNodeIds: string[];
	legacyCellIdByCellId: Record<TableCellId, string>;
}

function boundedCount(value: number | undefined, fallback: number) {
	return Math.max(1, Math.min(MAX_AXIS, Number.isInteger(value) ? value! : fallback));
}

export function emptyTableCellContent(text = ""): TableCellContent {
	return { version: 1, blocks: [{ type: "paragraph", runs: [{ text }] }] };
}

function contentFromNode(node: MindmapNode | undefined) {
	return emptyTableCellContent(node?.topic ?? "");
}

function axisSize(value: number | undefined, total: number, count: number) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : total / count;
}

function legacyCellBox(node: MindmapNode, row: number, column: number, rows: number, columns: number) {
	const table = node.table!;
	const width = node.width ?? DEFAULT_TABLE_WIDTH;
	const height = node.height ?? DEFAULT_TABLE_HEIGHT;
	const columnSizes = Array.from({ length: columns }, (_, index) => axisSize(table.columnWidths?.[index], width, columns));
	const rowSizes = Array.from({ length: rows }, (_, index) => axisSize(table.rowHeights?.[index], height, rows));
	return {
		x: (node.x ?? 0) + columnSizes.slice(0, column).reduce((sum, size) => sum + size, 0),
		y: (node.y ?? 0) + rowSizes.slice(0, row).reduce((sum, size) => sum + size, 0),
		width: columnSizes[column] ?? width / columns,
		height: rowSizes[row] ?? height / rows,
	};
}

function itemFromLegacyNode(node: MindmapNode, cellBox: ReturnType<typeof legacyCellBox>, order: number): TableCellItem {
	const width = Math.max(1, Math.min(node.width ?? cellBox.width, cellBox.width));
	const height = Math.max(1, Math.min(node.height ?? cellBox.height, cellBox.height));
	return {
		nodeId: node.id,
		order,
		rect: {
			x: Math.max(0, Math.min((node.x ?? cellBox.x) - cellBox.x, cellBox.width - width)),
			y: Math.max(0, Math.min((node.y ?? cellBox.y) - cellBox.y, cellBox.height - height)),
			width,
			height,
		},
	};
}

function normalizeExistingV2(tableId: string, table: MindmapTableV2): MindmapTableV2 {
	const rows = table.rows.length ? table.rows : [{ id: `row:${tableId}:0`, size: DEFAULT_TABLE_HEIGHT }];
	const columns = table.columns.length ? table.columns : [{ id: `column:${tableId}:0`, size: DEFAULT_TABLE_WIDTH }];
	const cells = Object.fromEntries(Object.entries(table.cells || {}).map(([cellId, cell]) => [cellId, {
		rowId: cell.rowId,
		columnId: cell.columnId,
		content: cell.content?.version === 1 ? cell.content : emptyTableCellContent(),
		items: Array.isArray(cell.items) ? cell.items.filter((item) => item && typeof item.nodeId === "string") : [],
	}]));
	return { version: 2, rows, columns, cells, ...(table.headerRow ? { headerRow: true } : {}) };
}

export function normalizeLegacyTableNode(node: MindmapNode): TableMigrationResult | undefined {
	if (node.tableV2) {
		const table = normalizeExistingV2(node.id, node.tableV2);
		return { table, source: "v2", contentNodeIds: [], legacyCellIdByCellId: {} };
	}
	const legacy = node.table;
	if (!legacy) return undefined;
	const rows = boundedCount(legacy.rows, 3);
	const columns = boundedCount(legacy.columns, 3);
	const rowEntries = Array.from({ length: rows }, (_, row) => ({ id: `row:${node.id}:${row}`, size: axisSize(legacy.rowHeights?.[row], node.height ?? DEFAULT_TABLE_HEIGHT, rows) }));
	const columnEntries = Array.from({ length: columns }, (_, column) => ({ id: `column:${node.id}:${column}`, size: axisSize(legacy.columnWidths?.[column], node.width ?? DEFAULT_TABLE_WIDTH, columns) }));
	const cells: MindmapTableV2["cells"] = {};
	const contentNodeIds: string[] = [];
	const legacyCellIdByCellId: Record<string, string> = {};
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			const legacyCellId = legacyTableCellId(row, column);
			const cellId = stableTableCellId(node.id, row, column);
			const nodeIds = Array.isArray(legacy.cellNodeIds?.[legacyCellId]) ? legacy.cellNodeIds[legacyCellId] : [];
			const cellNodes = nodeIds.map((id) => node.children.find((child) => child.id === id)).filter((child): child is MindmapNode => !!child);
			const contentNode = cellNodes[0];
			if (contentNode) contentNodeIds.push(contentNode.id);
			const box = legacyCellBox(node, row, column, rows, columns);
			cells[cellId] = {
				rowId: rowEntries[row].id,
				columnId: columnEntries[column].id,
				content: contentFromNode(contentNode),
				items: cellNodes.slice(1).map((item, order) => itemFromLegacyNode(item, box, order)),
			};
			legacyCellIdByCellId[cellId] = legacyCellId;
		}
	}
	return {
		table: { version: 2, rows: rowEntries, columns: columnEntries, cells, ...(legacy.headerRow ? { headerRow: true } : {}) },
		source: "legacy",
		contentNodeIds,
		legacyCellIdByCellId,
	};
}

export function normalizeTableNode(node: MindmapNode): MindmapNode {
	const migration = normalizeLegacyTableNode(node);
	if (!migration) return node;
	const legacyContentIds = migration.contentNodeIds.length
		? migration.contentNodeIds
		: Object.values(node.table?.cellNodeIds ?? {}).flat().filter((id) => (
			!Object.values(migration.table.cells).some((cell) => cell.items.some((item) => item.nodeId === id))
		));
	return stripLegacyFields({ ...node, tableV2: migration.table }, new Set(legacyContentIds));
}

function stripLegacyFields(node: MindmapNode, contentNodeIds: Set<string>): MindmapNode {
	const next = { ...node, children: node.children.filter((child) => !contentNodeIds.has(child.id)).map((child) => stripLegacyFields(child, contentNodeIds)) };
	delete next.table;
	delete next.tableId;
	delete next.tableCellId;
	return next;
}
