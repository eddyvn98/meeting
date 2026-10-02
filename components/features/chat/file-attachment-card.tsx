"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
	FileText,
	FileSpreadsheet,
	Archive,
	File,
	Image as ImageIcon,
	Download,
	Eye,
	type LucideIcon,
} from "lucide-react";
import FilePreviewPanel from "./file-preview-panel";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileBlock {
	fileName: string;
	fileUrl: string;
	expiryLabel?: string;
}

interface ExtConfig {
	icon: LucideIcon;
	color: string;
	bg: string;
	label: string;
	previewable: boolean;
}

// ─── Extension → visual config ────────────────────────────────────────────────

const EXT_CONFIG: Record<string, ExtConfig> = {
	docx: {
		icon: FileText,
		color: "text-blue-600 dark:text-blue-400",
		bg: "bg-blue-50 dark:bg-blue-950/40",
		label: "Word Document",
		previewable: true,
	},
	doc: {
		icon: FileText,
		color: "text-blue-600 dark:text-blue-400",
		bg: "bg-blue-50 dark:bg-blue-950/40",
		label: "Word Document",
		previewable: true,
	},
	pdf: {
		icon: FileText,
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-50 dark:bg-red-950/40",
		label: "PDF Document",
		previewable: true,
	},
	xlsx: {
		icon: FileSpreadsheet,
		color: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-50 dark:bg-emerald-950/40",
		label: "Excel Spreadsheet",
		previewable: false,
	},
	xls: {
		icon: FileSpreadsheet,
		color: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-50 dark:bg-emerald-950/40",
		label: "Excel Spreadsheet",
		previewable: false,
	},
	csv: {
		icon: FileSpreadsheet,
		color: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-50 dark:bg-emerald-950/40",
		label: "CSV File",
		previewable: true,
	},
	pptx: {
		icon: File,
		color: "text-orange-600 dark:text-orange-400",
		bg: "bg-orange-50 dark:bg-orange-950/40",
		label: "PowerPoint",
		previewable: false,
	},
	ppt: {
		icon: File,
		color: "text-orange-600 dark:text-orange-400",
		bg: "bg-orange-50 dark:bg-orange-950/40",
		label: "PowerPoint",
		previewable: false,
	},
	zip: {
		icon: Archive,
		color: "text-violet-600 dark:text-violet-400",
		bg: "bg-violet-50 dark:bg-violet-950/40",
		label: "ZIP Archive",
		previewable: false,
	},
	rar: {
		icon: Archive,
		color: "text-violet-600 dark:text-violet-400",
		bg: "bg-violet-50 dark:bg-violet-950/40",
		label: "RAR Archive",
		previewable: false,
	},
	txt: {
		icon: FileText,
		color: "text-gray-600 dark:text-gray-400",
		bg: "bg-gray-100 dark:bg-gray-800",
		label: "Text File",
		previewable: true,
	},
	md: {
		icon: FileText,
		color: "text-gray-600 dark:text-gray-400",
		bg: "bg-gray-100 dark:bg-gray-800",
		label: "Markdown File",
		previewable: true,
	},
	json: {
		icon: FileText,
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-50 dark:bg-amber-950/40",
		label: "JSON File",
		previewable: true,
	},
	png: {
		icon: ImageIcon,
		color: "text-violet-600 dark:text-violet-400",
		bg: "bg-violet-50 dark:bg-violet-950/40",
		label: "PNG Image",
		previewable: true,
	},
	jpg: {
		icon: ImageIcon,
		color: "text-violet-600 dark:text-violet-400",
		bg: "bg-violet-50 dark:bg-violet-950/40",
		label: "JPEG Image",
		previewable: true,
	},
	jpeg: {
		icon: ImageIcon,
		color: "text-violet-600 dark:text-violet-400",
		bg: "bg-violet-50 dark:bg-violet-950/40",
		label: "JPEG Image",
		previewable: true,
	},
	webp: {
		icon: ImageIcon,
		color: "text-violet-600 dark:text-violet-400",
		bg: "bg-violet-50 dark:bg-violet-950/40",
		label: "WebP Image",
		previewable: true,
	},
};

const FALLBACK_CONFIG: ExtConfig = {
	icon: File,
	color: "text-gray-600 dark:text-gray-400",
	bg: "bg-gray-100 dark:bg-gray-800",
	label: "File",
	previewable: false,
};

export function getFileTypeConfig(fileName: string): ExtConfig & { ext: string } {
	const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
	const config = EXT_CONFIG[ext] ?? {
		...FALLBACK_CONFIG,
		label: ext ? ext.toUpperCase() + " File" : "File",
	};
	return { ...config, ext };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileAttachmentCard({ fileName, fileUrl, expiryLabel }: FileBlock) {
	const [previewOpen, setPreviewOpen] = useState(false);

	const config = getFileTypeConfig(fileName);
	const Icon = config.icon;

	const truncatedName =
		fileName.length > 52 ? fileName.slice(0, 49) + "…" : fileName;

	return (
		<>
			<div className="group relative flex items-center gap-3 rounded-2xl border border-gray-200/90 dark:border-gray-700/60 bg-white dark:bg-gray-900/70 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 p-3 w-full">
				{/* Icon badge */}
				<div
					className={`flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 ${config.bg}`}
				>
					<Icon className={`w-[17px] h-[17px] ${config.color}`} />
				</div>

				{/* File metadata */}
				<div className="flex-1 min-w-0">
					<p
						className="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100 truncate leading-snug mb-0.5"
						title={fileName}
					>
						{truncatedName}
					</p>
					<span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
						{config.label}
					</span>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-1.5 flex-shrink-0">
					{config.previewable && (
						<button
							onClick={() => setPreviewOpen(true)}
							className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-gray-600 transition-all duration-150"
							title="Preview file"
							aria-label={`Preview ${fileName}`}
						>
							<Eye size={13} />
							<span className="hidden sm:inline">Preview</span>
						</button>
					)}
					<a
						href={fileUrl}
						target="_blank"
						rel="noopener noreferrer"
						download={fileName}
						className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold text-[hsl(var(--primary))] rounded-lg hover:bg-[hsl(var(--primary))]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/40 transition-all duration-150"
						title="Download file"
						aria-label={`Download ${fileName}`}
					>
						<Download size={13} />
						<span className="hidden sm:inline">Download</span>
					</a>
				</div>
			</div>

			{/* Preview panel — portal to document.body so it escapes all scroll containers */}
			{previewOpen &&
				typeof document !== "undefined" &&
				createPortal(
					<FilePreviewPanel
						fileName={fileName}
						fileUrl={fileUrl}
						ext={config.ext}
						onClose={() => setPreviewOpen(false)}
					/>,
					document.body,
				)}
		</>
	);
}
