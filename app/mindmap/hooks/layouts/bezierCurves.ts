import { X_GAP, Y_GAP } from "./layoutHelpers";

export const bezierH = (sx: number, sy: number, ex: number, ey: number) => {
	const off = Math.min(X_GAP / 2, Math.abs(ex - sx) / 2);
	return `M ${sx} ${sy} C ${sx + off} ${sy}, ${ex - off} ${ey}, ${ex} ${ey}`;
};

export const bezierHWithSharedTrunk = (sx: number, sy: number, ex: number, ey: number) => {
	const direction = Math.sign(ex - sx) || 1;
	const trunk = Math.min(X_GAP / 2, Math.abs(ex - sx) / 2);
	if (!trunk) return `M ${sx} ${sy}`;
	const junctionX = sx + direction * trunk;
	const branchOffset = Math.min(X_GAP / 2, Math.abs(ex - junctionX) / 2);
	return `M ${sx} ${sy} H ${junctionX} C ${junctionX + direction * branchOffset} ${sy}, ${ex - direction * branchOffset} ${ey}, ${ex} ${ey}`;
};

export const bezierHLeft = (sx: number, sy: number, ex: number, ey: number) => {
	const off = Math.min(X_GAP / 2, Math.abs(ex - sx) / 2);
	return `M ${sx} ${sy} C ${sx - off} ${sy}, ${ex + off} ${ey}, ${ex} ${ey}`;
};

export const bezierV = (sx: number, sy: number, ex: number, ey: number) => {
	const off = Math.min(Y_GAP * 2, Math.abs(ey - sy) / 2);
	const dir = ey >= sy ? 1 : -1;
	return `M ${sx} ${sy} C ${sx} ${sy + dir * off}, ${ex} ${ey - dir * off}, ${ex} ${ey}`;
};

export const bezierVWithSharedTrunk = (sx: number, sy: number, ex: number, ey: number) => {
	const direction = Math.sign(ey - sy) || 1;
	const trunk = Math.min(Y_GAP * 1.5, Math.abs(ey - sy) / 2);
	if (!trunk) return `M ${sx} ${sy}`;
	const junctionY = sy + direction * trunk;
	const branchOffset = Math.min(Y_GAP * 1.5, Math.abs(ey - junctionY) / 2);
	return `M ${sx} ${sy} V ${junctionY} C ${sx} ${junctionY + direction * branchOffset}, ${ex} ${ey - direction * branchOffset}, ${ex} ${ey}`;
};
