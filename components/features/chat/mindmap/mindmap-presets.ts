export interface StylePreset {
	id: string;
	name: string;
	bgClass: string;
	canvasBg: string;
	lineColor: string;
	rootBg: string;
	rootBorder: string;
	rootText: string;
	branchColors: string[];
	textClass: string;
}

export const STYLE_PRESETS: StylePreset[] = [
	{
		id: "pastel",
		name: "Soft Pastel",
		bgClass: "bg-slate-900 text-slate-100",
		canvasBg: "#111317",
		lineColor: "#f472b6",
		rootBg: "#2d2f3e",
		rootBorder: "#c084fc",
		rootText: "#ffffff",
		branchColors: ["#fca5a5", "#fcd34d", "#86efac", "#93c5fd", "#c084fc", "#f472b6"],
		textClass: "text-slate-300"
	},
	{
		id: "minimal",
		name: "Minimalist",
		bgClass: "bg-zinc-950 text-zinc-100",
		canvasBg: "#09090b",
		lineColor: "#71717a",
		rootBg: "#27272a",
		rootBorder: "#52525b",
		rootText: "#ffffff",
		branchColors: ["#d4d4d8", "#a1a1aa", "#71717a", "#e4e4e7", "#d4d4d8", "#a1a1aa"],
		textClass: "text-zinc-400"
	},
	{
		id: "monochrome",
		name: "Monochrome Blue",
		bgClass: "bg-slate-950 text-slate-100",
		canvasBg: "#0a1128",
		lineColor: "#3b82f6",
		rootBg: "#172554",
		rootBorder: "#2563eb",
		rootText: "#ffffff",
		branchColors: ["#60a5fa", "#3b82f6", "#1d4ed8", "#93c5fd", "#bfdbfe", "#2563eb"],
		textClass: "text-blue-200"
	},
	{
		id: "vibrant",
		name: "Vibrant Neon",
		bgClass: "bg-[#0a0616] text-white",
		canvasBg: "#06030c",
		lineColor: "#d946ef",
		rootBg: "#3b0764",
		rootBorder: "#d946ef",
		rootText: "#ffffff",
		branchColors: ["#f43f5e", "#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#3b82f6"],
		textClass: "text-purple-300"
	}
];
