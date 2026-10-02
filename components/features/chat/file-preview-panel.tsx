"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	X,
	Download,
	AlertCircle,
	Loader2,
	FileText,
	FileSpreadsheet,
	File,
	Image as ImageIcon,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
	fileName: string;
	fileUrl: string;
	ext: string;
	onClose: () => void;
}

function proxied(url: string): string {
	// Local API paths and blob URLs don't need the proxy
	if (url.startsWith("/") || url.startsWith("blob:")) return url;
	return `/api/proxy/file/?url=${encodeURIComponent(url)}`;
}

type Strategy = "docx" | "pdf" | "image" | "text" | "csv" | "unsupported";

// ─── Strategy detection ───────────────────────────────────────────────────────

function getStrategy(ext: string): Strategy {
	const e = ext.toLowerCase();
	if (e === "docx" || e === "doc") return "docx";
	if (e === "pdf") return "pdf";
	if (["png", "jpg", "jpeg", "webp", "gif"].includes(e)) return "image";
	if (e === "txt" || e === "json" || e === "md") return "text";
	if (e === "csv") return "csv";
	return "unsupported";
}

const STRATEGY_META: Record<
	Strategy,
	{ label: string; iconBg: string; iconColor: string }
> = {
	docx: {
		label: "Document Preview",
		iconBg: "bg-blue-50 dark:bg-blue-950/40",
		iconColor: "text-blue-600 dark:text-blue-400",
	},
	pdf: {
		label: "PDF Preview",
		iconBg: "bg-red-50 dark:bg-red-950/40",
		iconColor: "text-red-600 dark:text-red-400",
	},
	image: {
		label: "Image Preview",
		iconBg: "bg-violet-50 dark:bg-violet-950/40",
		iconColor: "text-violet-600 dark:text-violet-400",
	},
	text: {
		label: "Text Preview",
		iconBg: "bg-gray-100 dark:bg-gray-800",
		iconColor: "text-gray-600 dark:text-gray-400",
	},
	csv: {
		label: "Spreadsheet Preview",
		iconBg: "bg-emerald-50 dark:bg-emerald-950/40",
		iconColor: "text-emerald-600 dark:text-emerald-400",
	},
	unsupported: {
		label: "File Preview",
		iconBg: "bg-gray-100 dark:bg-gray-800",
		iconColor: "text-gray-500 dark:text-gray-500",
	},
};

// ─── Shared loading / error states ────────────────────────────────────────────

function LoadingState({ label }: { label: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-500 py-20">
			<Loader2 size={28} className="animate-spin" />
			<p className="text-[13px]">{label}</p>
		</div>
	);
}

function FetchErrorState({
	msg,
	fileUrl,
	fileName,
}: {
	msg: string;
	fileUrl: string;
	fileName: string;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-5 px-10 py-20 text-center">
			<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-950/30">
				<AlertCircle size={26} className="text-red-500 dark:text-red-400" />
			</div>
			<div>
				<p className="text-[14px] font-semibold text-gray-800 dark:text-gray-200 mb-1">
					Preview unavailable
				</p>
				<p className="text-[12px] text-gray-500 dark:text-gray-400 max-w-[320px] leading-relaxed">
					{msg}
				</p>
			</div>
			<a
				href={fileUrl}
				target="_blank"
				rel="noopener noreferrer"
				download={fileName}
				className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition-colors duration-150"
			>
				<Download size={14} />
				Download to view
			</a>
		</div>
	);
}

// ─── Type-specific renderers ──────────────────────────────────────────────────

function DocxRenderer({
	fileUrl,
	fileName,
}: {
	fileUrl: string;
	fileName: string;
}) {
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [html, setHtml] = useState("");
	const [errorMsg, setErrorMsg] = useState("");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(proxied(fileUrl));
				if (!res.ok)
					throw new Error(`Could not fetch file — server returned ${res.status}`);
				const arrayBuffer = await res.arrayBuffer();
				const mammoth = await import("mammoth");
				const { value } = await mammoth.convertToHtml({ arrayBuffer });
				if (!cancelled) {
					setHtml(value);
					setState("ready");
				}
			} catch (err) {
				if (!cancelled) {
					setErrorMsg(
						err instanceof Error ? err.message : "Failed to load document.",
					);
					setState("error");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fileUrl]);

	if (state === "loading") return <LoadingState label="Rendering document…" />;
	if (state === "error")
		return (
			<FetchErrorState msg={errorMsg} fileUrl={fileUrl} fileName={fileName} />
		);
	return (
		<div
			className="docx-preview px-8 py-7"
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

function PdfRenderer({ fileUrl }: { fileUrl: string }) {
	return (
		<div className="flex h-full flex-col">
			<iframe
				src={proxied(fileUrl)}
				className="flex-1 w-full border-0"
				title="PDF Preview"
			/>
			<div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-5 py-2.5 flex items-center justify-center">
				<a
					href={fileUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="text-[12px] text-gray-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
				>
					Can&apos;t view the PDF? Open in a new tab →
				</a>
			</div>
		</div>
	);
}

function ImageRenderer({
	fileUrl,
	fileName,
}: {
	fileUrl: string;
	fileName: string;
}) {
	const [errored, setErrored] = useState(false);

	if (errored) {
		return (
			<FetchErrorState
				msg="Could not load this image. The URL may have expired or the file is inaccessible."
				fileUrl={fileUrl}
				fileName={fileName}
			/>
		);
	}

	return (
		<div className="flex h-full items-center justify-center p-6 bg-gray-50/60 dark:bg-gray-900/50">
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img
				src={fileUrl}
				alt={fileName}
				className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
				onError={() => setErrored(true)}
			/>
		</div>
	);
}

function TextRenderer({
	fileUrl,
	fileName,
	ext,
}: {
	fileUrl: string;
	fileName: string;
	ext: string;
}) {
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [content, setContent] = useState("");
	const [errorMsg, setErrorMsg] = useState("");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(proxied(fileUrl));
				if (!res.ok) throw new Error(`Server returned ${res.status}`);
				const raw = await res.text();
				if (!cancelled) {
					if (ext === "json") {
						try {
							setContent(JSON.stringify(JSON.parse(raw), null, 2));
						} catch {
							setContent(raw);
						}
					} else {
						setContent(raw);
					}
					setState("ready");
				}
			} catch (err) {
				if (!cancelled) {
					setErrorMsg(
						err instanceof Error ? err.message : "Failed to load file.",
					);
					setState("error");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fileUrl, ext]);

	if (state === "loading") return <LoadingState label="Loading file…" />;
	if (state === "error")
		return (
			<FetchErrorState msg={errorMsg} fileUrl={fileUrl} fileName={fileName} />
		);
	return (
		<div className="p-5">
			<pre className="text-[12.5px] leading-[1.75] font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-900/70 rounded-xl p-5 border border-gray-200/80 dark:border-gray-800">
				{content}
			</pre>
		</div>
	);
}

function CsvRenderer({
	fileUrl,
	fileName,
}: {
	fileUrl: string;
	fileName: string;
}) {
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [rows, setRows] = useState<string[][]>([]);
	const [errorMsg, setErrorMsg] = useState("");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(proxied(fileUrl));
				if (!res.ok) throw new Error(`Server returned ${res.status}`);
				const text = await res.text();
				const { default: Papa } = await import("papaparse");
				const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
				if (!cancelled) {
					setRows(result.data);
					setState("ready");
				}
			} catch (err) {
				if (!cancelled) {
					setErrorMsg(
						err instanceof Error ? err.message : "Failed to parse CSV.",
					);
					setState("error");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fileUrl]);

	if (state === "loading") return <LoadingState label="Parsing spreadsheet…" />;
	if (state === "error")
		return (
			<FetchErrorState msg={errorMsg} fileUrl={fileUrl} fileName={fileName} />
		);

	const [header, ...body] = rows;
	return (
		<div className="overflow-auto p-1">
			<table className="min-w-full border-collapse text-[12px]">
				{header && (
					<thead className="bg-gray-50 dark:bg-gray-800/70 sticky top-0 z-10">
						<tr>
							{header.map((col, i) => (
								<th
									key={i}
									className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap"
								>
									{col}
								</th>
							))}
						</tr>
					</thead>
				)}
				<tbody>
					{body.map((row, ri) => (
						<tr
							key={ri}
							className={
								ri % 2 === 0 ? "" : "bg-gray-50/60 dark:bg-gray-900/40"
							}
						>
							{row.map((cell, ci) => (
								<td
									key={ci}
									className="px-3 py-2 text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800/60 align-top break-words"
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function UnsupportedRenderer({
	fileUrl,
	fileName,
}: {
	fileUrl: string;
	fileName: string;
}) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-5 px-10 py-20 text-center">
			<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
				<File size={26} className="text-gray-400 dark:text-gray-500" />
			</div>
			<div>
				<p className="text-[14px] font-semibold text-gray-800 dark:text-gray-200 mb-1">
					Preview not available
				</p>
				<p className="text-[12px] text-gray-500 dark:text-gray-400 max-w-[280px] leading-relaxed">
					This file type cannot be previewed in the browser. Download it to open
					in a compatible application.
				</p>
			</div>
			<a
				href={fileUrl}
				target="_blank"
				rel="noopener noreferrer"
				download={fileName}
				className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition-colors duration-150"
			>
				<Download size={14} />
				Download file
			</a>
		</div>
	);
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function FilePreviewPanel({
	fileName,
	fileUrl,
	ext,
	onClose,
}: Props) {
	const strategy = getStrategy(ext);
	const meta = STRATEGY_META[strategy];

	// Escape key + body scroll lock
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handler);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", handler);
			document.body.style.overflow = prev;
		};
	}, [onClose]);

	// Portalled to document.body — this panel uses position:fixed to dock to
	// the viewport's right edge, which breaks if any ancestor (e.g. the
	// sidebar's Framer Motion wrappers) has a CSS transform, trapping the
	// "fixed" element inside that ancestor's bounds instead of the viewport.
	return createPortal(
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-200"
				onClick={onClose}
				aria-hidden="true"
			/>

			{/* Slide-in panel */}
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`Preview: ${fileName}`}
				className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-[680px] flex-col bg-white dark:bg-gray-950 shadow-2xl animate-in slide-in-from-right duration-250 ease-out"
				style={{ boxShadow: "-4px 0 40px rgba(0,0,0,0.18)" }}
			>
				{/* ── Header ─────────────────────────────────────────────────── */}
				<div className="flex items-center gap-3 flex-shrink-0 px-3 py-3 sm:px-5 sm:py-4 border-b border-gray-200 dark:border-gray-800">
					<div
						className={`flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0 ${meta.iconBg}`}
					>
						{strategy === "image" ? (
							<ImageIcon className={`h-[17px] w-[17px] ${meta.iconColor}`} />
						) : strategy === "csv" ? (
							<FileSpreadsheet
								className={`h-[17px] w-[17px] ${meta.iconColor}`}
							/>
						) : (
							<FileText className={`h-[17px] w-[17px] ${meta.iconColor}`} />
						)}
					</div>
					<div className="flex-1 min-w-0">
						<p
							className="text-[13.5px] font-semibold text-gray-900 dark:text-gray-100 truncate"
							title={fileName}
						>
							{fileName}
						</p>
						<p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
							{meta.label}
						</p>
					</div>
					<a
						href={fileUrl}
						target="_blank"
						rel="noopener noreferrer"
						download={fileName}
						className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] sm:px-3 font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors duration-150 flex-shrink-0"
					>
						<Download size={12} />
						<span className="hidden sm:inline">Download</span>
					</a>
					<button
						onClick={onClose}
						className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-150"
						aria-label="Close preview"
					>
						<X size={15} />
					</button>
				</div>

				{/* ── Content ────────────────────────────────────────────────── */}
				{/* PDF gets its own flex container so the iframe fills remaining height */}
				<div className="flex-1 min-h-0 overflow-hidden">
					{strategy === "pdf" ? (
						<PdfRenderer fileUrl={fileUrl} />
					) : (
						<div className="h-full overflow-y-auto overscroll-contain">
							{strategy === "docx" && (
								<DocxRenderer fileUrl={fileUrl} fileName={fileName} />
							)}
							{strategy === "image" && (
								<ImageRenderer fileUrl={fileUrl} fileName={fileName} />
							)}
							{strategy === "text" && (
								<TextRenderer fileUrl={fileUrl} fileName={fileName} ext={ext} />
							)}
							{strategy === "csv" && (
								<CsvRenderer fileUrl={fileUrl} fileName={fileName} />
							)}
							{strategy === "unsupported" && (
								<UnsupportedRenderer fileUrl={fileUrl} fileName={fileName} />
							)}
						</div>
					)}
				</div>
			</div>
		</>,
		document.body,
	);
}
