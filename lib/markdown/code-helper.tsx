"use client";
import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { MindmapPreview } from "@/components/features/chat/mindmap/mindmap-preview";
import { MermaidBlock } from "@/components/features/chat/mindmap/mermaid-block";

interface CodeBlockProps {
	language?: string;
	code: string;
}

const CODE_BG = "#1a1d23";
const HEADER_BG = "#13161b";
const BORDER = "#2a2e38";

export default function CodeBlock({ language, code }: CodeBlockProps) {
	const [copied, setCopied] = useState(false);

	const isMindmap = language?.toLowerCase() === "mindmap" || language?.toLowerCase() === "mind-map";
	const isMermaid = language?.toLowerCase() === "mermaid";

	if (isMindmap) {
		return <MindmapPreview code={code} />;
	}

	if (isMermaid) {
		return <MermaidBlock code={code} />;
	}

	const handleCopy = async () => {
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const displayLanguage = language || "text";

	return (
		<div
			className="relative my-4 w-full max-w-full min-w-0 text-sm rounded-xl overflow-hidden"
			style={{ border: `1px solid ${BORDER}`, boxShadow: "0 4px 24px rgba(0,0,0,0.28)" }}
		>
			{/* ── Header bar ──────────────────────────────────────────────── */}
			<div
				className="flex items-center justify-between px-4 py-2.5"
				style={{ background: HEADER_BG, borderBottom: `1px solid ${BORDER}` }}
			>
				{/* Window dots + language label */}
				<div className="flex items-center gap-3 min-w-0">
					<div className="flex items-center gap-[5px] flex-shrink-0">
						<span className="w-[11px] h-[11px] rounded-full bg-[#ff5f57]" />
						<span className="w-[11px] h-[11px] rounded-full bg-[#febc2e]" />
						<span className="w-[11px] h-[11px] rounded-full bg-[#28c840]" />
					</div>
					<span
						className="font-mono text-[11.5px] tracking-wider select-none truncate uppercase"
						style={{ color: "#525966", letterSpacing: "0.06em" }}
					>
						{displayLanguage.toLowerCase()}
					</span>
				</div>

				{/* Copy button */}
				<button
					onClick={handleCopy}
					className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150 select-none flex-shrink-0"
					style={{
						color: copied ? "#86efac" : "#525966",
						background: "transparent",
					}}
					onMouseEnter={(e) => {
						if (!copied) (e.currentTarget as HTMLButtonElement).style.color = "#8b949e";
						(e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLButtonElement).style.color = copied ? "#86efac" : "#525966";
						(e.currentTarget as HTMLButtonElement).style.background = "transparent";
					}}
					aria-label="Copy code"
				>
					{copied ? (
						<>
							<Check className="w-3.5 h-3.5" />
							<span>Copied!</span>
						</>
					) : (
						<>
							<Copy className="w-3.5 h-3.5" />
							<span>Copy</span>
						</>
					)}
				</button>
			</div>

			{/* Single overflow-x-auto scroll layer — no nested competing scroll */}
			<div
				className="overflow-x-auto w-full min-w-0"
				style={{ background: CODE_BG }}
			>
				<SyntaxHighlighter
					language={displayLanguage}
					style={oneDark}
					PreTag="div"
					customStyle={{
						margin: 0,
						padding: "16px 20px",
						fontSize: "12.5px",
						lineHeight: "1.8",
						borderRadius: 0,
						background: CODE_BG,
						fontFamily:
							"var(--font-mono, 'JetBrains Mono', 'Fira Code', Consolas, monospace)",
						overflow: "visible",
						minWidth: "max-content",
					}}
					showLineNumbers
					lineNumberStyle={{
						minWidth: "2.5em",
						paddingRight: "1.5em",
						color: "#2e3440",
						userSelect: "none",
						fontSize: "11px",
						fontFamily: "inherit",
					}}
					wrapLines={false}
					wrapLongLines={false}
				>
					{code}
				</SyntaxHighlighter>
			</div>
		</div>
	);
}
