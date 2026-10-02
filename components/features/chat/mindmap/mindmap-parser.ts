import type { MindmapNode } from "./mindmap-types";

const DATA_BLOCK_START = "<!--MINDMAP_DATA";
const DATA_BLOCK_END = "MINDMAP_DATA-->";

function reviveJsonNode(node: any): MindmapNode {
	return {
		id: node.id || Math.random().toString(36).substring(2, 9),
		topic: node.topic || node.name || "Node",
		children: Array.isArray(node.children) ? node.children.map(reviveJsonNode) : [],
		expanded: node.expanded !== false,
		style: node.style,
		descriptionStyle: node.descriptionStyle,
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
		floating: node.floating,
		description: node.description,
		icon: node.icon,
		image: node.image,
		link: node.link,
		relationships: Array.isArray(node.relationships) ? node.relationships : undefined,
		table: node.table,
		tableV2: node.tableV2,
		tableId: node.tableId,
		tableCellId: node.tableCellId,
	};
}

export function parseMindmapText(text: string): MindmapNode {
	// Try parsing as JSON first
	try {
		const cleaned = text.trim();
		if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
			const data = JSON.parse(cleaned);
			if (data && typeof data === "object" && (data.topic || data.name)) {
				return reviveJsonNode(data);
			}
		}
	} catch (e) {
		// Not JSON, fall back to parsing markdown
	}

	const roots = parseMindmapTextToMultiple(text);
	if (roots.length === 0) {
		return { id: "root", topic: "Mindmap", children: [] };
	}
	if (roots.length === 1) {
		return roots[0];
	}
	// Fallback for single-map parser when multiple roots exist:
	// Use the first root and attach the others as its children
	const firstRoot = roots[0];
	for (let i = 1; i < roots.length; i++) {
		firstRoot.children.push(roots[i]);
	}
	return firstRoot;
}

export function serializeMindmapToText(node: MindmapNode, depth = 0): string {
	const indent = "  ".repeat(depth);
	let result = `${indent}- ${node.topic}\n`;
	if (node.children && node.children.length > 0) {
		for (const child of node.children) {
			result += serializeMindmapToText(child, depth + 1);
		}
	}
	return result;
}

// Appends a hidden JSON block (an HTML comment, invisible in any Markdown
// renderer) carrying every node/style field the plain outline can't express —
// position, shape, colors, tables, relationships. Re-importing this file
// reconstructs the canvas exactly instead of just the topic hierarchy.
export function serializeMultipleMindmapsToText(nodes: MindmapNode[]): string {
	const outline = nodes.map((node) => serializeMindmapToText(node, 0)).join("");
	const dataBlock = `${DATA_BLOCK_START}\n${JSON.stringify(nodes)}\n${DATA_BLOCK_END}\n`;
	return `${outline}\n${dataBlock}`;
}

function extractEmbeddedDataBlock(text: string): MindmapNode[] | null {
	const start = text.indexOf(DATA_BLOCK_START);
	if (start === -1) return null;
	const end = text.indexOf(DATA_BLOCK_END, start);
	if (end === -1) return null;
	const jsonText = text.slice(start + DATA_BLOCK_START.length, end).trim();
	try {
		const data = JSON.parse(jsonText);
		if (!Array.isArray(data)) return null;
		return data.map(reviveJsonNode);
	} catch (e) {
		return null;
	}
}

export function parseMindmapTextToMultiple(text: string): MindmapNode[] {
	const embedded = extractEmbeddedDataBlock(text);
	// A well-formed block is authoritative even when it holds no maps. Falling
	// through on an empty one sent the file to the outline parser, which then read
	// the block's own comment markers as content — importing an empty export
	// produced three nodes named `<!--MINDMAP_DATA`, `[]` and `MINDMAP_DATA-->`.
	if (embedded) return embedded;

	// Try parsing as JSON first
	try {
		const cleaned = text.trim();
		if (cleaned.startsWith("[") || (cleaned.startsWith("{") && cleaned.endsWith("}"))) {
			const data = JSON.parse(cleaned);
			if (Array.isArray(data)) {
				return data.map(reviveJsonNode);
			} else if (data && typeof data === "object" && (data.topic || data.name)) {
				return [reviveJsonNode(data)];
			}
		}
	} catch (e) {
		// Not JSON, fall back to parsing markdown
	}

	try {
		// Parse markdown list
		const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
		if (lines.length === 0) {
			return [{ id: "root", topic: "Mindmap", children: [] }];
		}

		const roots: MindmapNode[] = [];
		const stack: { type: "heading" | "list"; level: number; node: MindmapNode }[] = [];

		for (const line of lines) {
			const headingMatch = line.match(/^(\s*)(#{1,6})\s+(.*)$/);
			const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);

			let type: "heading" | "list";
			let level: number;
			let cleanTopic: string;

			if (headingMatch) {
				type = "heading";
				level = headingMatch[2].length;
				cleanTopic = headingMatch[3].trim();
			} else if (listMatch) {
				type = "list";
				level = listMatch[1].length;
				cleanTopic = listMatch[3].trim();
			} else {
				type = "list";
				const indentMatch = line.match(/^(\s*)/);
				level = indentMatch ? indentMatch[1].length : 0;
				cleanTopic = line.trim();
			}

			if (!cleanTopic) continue;

			const currentNode: MindmapNode = {
				id: Math.random().toString(36).substring(2, 9),
				topic: cleanTopic,
				children: [],
				expanded: true,
			};

			if (type === "heading") {
				// Pop stack until we find a heading with level < current heading level
				while (stack.length > 0) {
					const top = stack[stack.length - 1];
					if (top.type === "heading" && top.level < level) {
						break;
					}
					stack.pop();
				}

				if (stack.length > 0) {
					stack[stack.length - 1].node.children.push(currentNode);
				} else {
					roots.push(currentNode);
				}
				stack.push({ type: "heading", level, node: currentNode });
			} else {
				// For list items:
				// Pop stack until we find either a list item with level < current list level, or a heading
				while (stack.length > 0) {
					const top = stack[stack.length - 1];
					if (top.type === "heading") {
						// Keep the heading as parent
						break;
					}
					if (top.type === "list" && top.level < level) {
						break;
					}
					stack.pop();
				}

				if (stack.length > 0) {
					stack[stack.length - 1].node.children.push(currentNode);
				} else {
					roots.push(currentNode);
				}
				stack.push({ type: "list", level, node: currentNode });
			}
		}

		if (roots.length === 0) {
			return [{ id: "root", topic: "Mindmap", children: [] }];
		}

		return roots;
	} catch (err) {
		console.error("[mindmap] failed to parse markdown mindmap:", err);
		return [];
	}
}
