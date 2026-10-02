export interface NodeVersionPreview {
	id?: string;
	topic?: string;
	description?: string;
	icon?: string;
	image?: string;
	images?: unknown[];
	link?: string;
	style?: Record<string, unknown>;
	descriptionStyle?: Record<string, unknown>;
	expanded?: boolean;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	floating?: boolean;
	floatingMapRoot?: boolean;
	table?: Record<string, unknown>;
	tableId?: string;
	tableCellId?: string;
}

export interface NodeEditEventItem {
	id: string;
	actorEmail: string;
	opType: string;
	createdAt: string;
	nodeVersion?: NodeVersionPreview | null;
}

export interface GroupedEdit {
	id: string;
	actorEmail: string;
	opType: string;
	latestAt: string;
	earliestAt: string;
	count: number;
	nodeVersion?: NodeVersionPreview | null;
}

const GROUP_WINDOW_MS = 3 * 60 * 1000;

export function groupEdits(events: NodeEditEventItem[]): GroupedEdit[] {
	const groups: GroupedEdit[] = [];
	for (const event of events) {
		const current = groups[groups.length - 1];
		const sameSitting = current
			&& current.actorEmail === event.actorEmail
			&& current.opType === event.opType
			&& new Date(current.earliestAt).getTime() - new Date(event.createdAt).getTime() <= GROUP_WINDOW_MS;
		if (sameSitting) {
			current.earliestAt = event.createdAt;
			current.count += 1;
			current.nodeVersion = event.nodeVersion ?? current.nodeVersion;
			continue;
		}
		groups.push({
			id: event.id,
			actorEmail: event.actorEmail,
			opType: event.opType,
			latestAt: event.createdAt,
			earliestAt: event.createdAt,
			count: 1,
			nodeVersion: event.nodeVersion,
		});
	}
	return groups;
}
