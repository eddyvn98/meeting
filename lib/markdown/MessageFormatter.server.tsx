import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import { Clock } from "lucide-react";
import { FileAttachmentCard } from "@/components/features/chat/file-attachment-card";
import {
	markFencedCodeBlocks,
	markdownComponents,
} from "@/lib/markdown/markdown-components";
import { normalizeQuotedDiagnosticFields } from "@/app/workspace/utils/workspaceChatVisibleContent";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
	content: string;
	/** When true, skip regex file detection and render as plain markdown.
	 *  Set this when the parent already has structured file data from message_files. */
	skipFileDetect?: boolean;
}

interface VideoPayload {
	status: string;
	video_url: string;
	task_id: string;
	billable_duration?: number | null;
}

interface FileBlock {
	fileName: string;
	fileUrl: string;
	expiryLabel?: string;
}

type Segment =
	| { kind: "text"; content: string }
	| { kind: "file"; data: FileBlock };

// ─── Video payload detection ──────────────────────────────────────────────────

function tryParseVideoPayload(content: string): VideoPayload | null {
	try {
		const parsed = JSON.parse(content);
		if (parsed?.status === "success" && typeof parsed?.video_url === "string") {
			return parsed as VideoPayload;
		}
	} catch {
		// not JSON
	}
	return null;
}

// ─── File reference eraser ────────────────────────────────────────────────────
const DOC_EXTENSIONS = "docx?|pdf|pptx?|xlsx?|md";

function eraseFileReferences(raw: string): string {
	let s = raw;

	// Markdown links whose href ends in a file extension: [name](https://...docx)
	// Also swallow a directly-enclosing pair of parentheses, e.g. text like
	// "(see [report](url.pdf))" — otherwise the wrapping "()" is left stranded
	// once the link itself is erased.
	s = s.replace(
		new RegExp(
			`\\(?!?\\[[^\\]]*\\]\\(https?:\\/\\/[^)\\s]*\\.(?:${DOC_EXTENSIONS})[^)]*\\)\\)?`,
			"gi",
		),
		"",
	);

	// "Cloud Link …" lines (label text the agent writes before the URL)
	s = s.replace(/^Cloud Link[^\n\r]*$/gim, "");

	// Bare https:// URLs that end in a file extension
	s = s.replace(
		new RegExp(`https?:\\/\\/\\S+\\.(?:${DOC_EXTENSIONS})(?:[?#]\\S*)?`, "gi"),
		"",
	);

	// Lines that contain only a filename (e.g. "report.docx")
	s = s.replace(
		new RegExp(`^[^\\n\\r]*\\.(?:${DOC_EXTENSIONS})\\s*$`, "gim"),
		"",
	);

	// Collapse now-empty bracket/paren pairs left behind by the erasures above
	// (e.g. a URL erased from inside "(...)" leaves a stray "()").
	s = s.replace(/\(\s*\)/g, "");
	s = s.replace(/\[\s*\]/g, "");

	// Lines left with only stray punctuation after the above erasures
	s = s.replace(/^[ \t]*[()[\].,;:]+[ \t]*$/gm, "");

	return s.replace(/\n{3,}/g, "\n\n").trim();
}

// ─── File block parsing ───────────────────────────────────────────────────────

// The trailing URL's char class excludes "()" (not just whitespace) so a
// directly-adjacent closing paren the model added to visually set the whole
// reference off from surrounding prose — e.g. "(...Cloud Link: <url>)" with
// no space before ")" — is never swallowed into the extracted download URL.
const CLOUD_LINK_RE = new RegExp(
	`(?:\\[([^\\]]+\\.(?:${DOC_EXTENSIONS}))\\]\\([^)\\n]*\\)|([^\\n\\r]+\\.(?:${DOC_EXTENSIONS})))\\s*[\\n\\r]+Cloud Link[^\\n\\r]*:[\\s\\S]*?(https?:\\/\\/[^\\s\\n\\r()]+)`,
	"gi",
);

// Pattern B: standalone file URL embedded directly in the AI text, e.g.
const BARE_URL_RE = new RegExp(
	`(?:!?\\[[^\\]]*\\]\\(|\\s|^)(https?:\\/\\/[^\\s\\n\\r"'<>()\\[\\]]+\\.(?:${DOC_EXTENSIONS}))(?:[?#][^\\s\\n\\r"'<>()\\[\\]]*)?`,
	"gim",
);

function fileNameFromUrl(url: string): string {
	try {
		const { pathname } = new URL(url);
		const seg = decodeURIComponent(pathname).split("/").filter(Boolean).pop();
		return seg || url;
	} catch {
		return url.split("/").pop() || url;
	}
}

function runRegex(
	re: RegExp,
	content: string,
	extractSegment: (match: RegExpExecArray) => { matchStart: number; matchEnd: number; data: FileBlock } | null,
): Segment[] {
	const segments: Segment[] = [];
	let lastIndex = 0;

	re.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = re.exec(content)) !== null) {
		const extracted = extractSegment(match);
		if (!extracted) continue;

		let { matchStart, matchEnd } = extracted;
		const { data } = extracted;

		// The model sometimes sets a file reference off from surrounding prose
		// with its own parentheses across multiple lines, e.g.
		// "(\n<filename>\nCloud Link: <url>\n)". The match above only spans the
		// reference itself — it must not swallow unrelated prose — which left
		// that wrapping "(" and ")" behind as stray characters in the text
		// segments on either side (a lone ")" ends up on its own line right
		// before the next paragraph). Only widen the match when there is a
		// genuinely balanced "(...)" immediately around it, skipping over
		// whitespace/newlines the model itself inserted, so punctuation
		// anywhere else in legitimate prose is never touched.
		let widenedStart = matchStart;
		while (widenedStart > 0 && /\s/.test(content[widenedStart - 1])) widenedStart--;
		let widenedEnd = matchEnd;
		while (widenedEnd < content.length && /\s/.test(content[widenedEnd])) widenedEnd++;
		if (
			widenedStart > 0 &&
			content[widenedStart - 1] === "(" &&
			widenedEnd < content.length &&
			content[widenedEnd] === ")"
		) {
			matchStart = widenedStart - 1;
			matchEnd = widenedEnd + 1;
		}

		if (matchStart > lastIndex) {
			const text = content.slice(lastIndex, matchStart).trim();
			if (text) segments.push({ kind: "text", content: text });
		}

		segments.push({ kind: "file", data });
		lastIndex = matchEnd;
	}

	if (lastIndex < content.length) {
		const text = content.slice(lastIndex).trim();
		if (text) segments.push({ kind: "text", content: text });
	}

	return segments;
}

function parseSegments(content: string): Segment[] {
	// Try Pattern A first (the structured "Cloud Link" format).
	// match[1] = filename from markdown link, match[2] = plain filename, match[3] = URL
	const withCloudLink = runRegex(CLOUD_LINK_RE, content, (match) => ({
		matchStart: match.index,
		matchEnd: match.index + match[0].length,
		data: {
			fileName: (match[1] || match[2]).trim(),
			fileUrl: match[3].trim(),
		},
	}));

	if (withCloudLink.some((s) => s.kind === "file")) return withCloudLink;

	// Pattern A found nothing — try Pattern B (bare file URL in text).
	// Only promote to a file card when the URL is on its own line or surrounded
	// by non-word characters so we don't break mid-sentence links.
	const withBareUrl = runRegex(BARE_URL_RE, content, (match) => {
		const url = match[1]?.trim();
		if (!url) return null;

		let matchEnd = match.index + match[0].length;
		// When the prefix that matched was markdown-link syntax ("[name](url"),
		// the URL's own char class (which excludes "()" so it never swallows
		// prose parens) stops just short of that link's closing ")" — so a
		// match here has one more "(" than ")" in it. Consume that single
		// syntactic closer too; it is part of the markdown link, not prose.
		const openParens = (match[0].match(/\(/g) || []).length;
		const closeParens = (match[0].match(/\)/g) || []).length;
		if (openParens > closeParens && content[matchEnd] === ")") {
			matchEnd += 1;
		}

		return {
			matchStart: match.index,
			matchEnd,
			data: {
				fileName: fileNameFromUrl(url),
				fileUrl: url,
			},
		};
	});

	if (withBareUrl.some((s) => s.kind === "file")) return withBareUrl;

	// No file blocks detected — treat the whole string as markdown text.
	return [{ kind: "text", content }];
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownBlock({ content }: { content: string }) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
			rehypePlugins={[rehypeRaw, rehypeKatex, markFencedCodeBlocks]}
			components={markdownComponents}
		>
			{content}
		</ReactMarkdown>
	);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function MessageFormatterServer({
	content,
	skipFileDetect = false,
}: Props) {
	content = normalizeQuotedDiagnosticFields(content);

	// Handle video payload (JSON blob from video generation module)
	const videoPayload = tryParseVideoPayload(content);
	if (videoPayload) {
		return (
			<div className="flex flex-col gap-3 my-2 min-w-0 max-w-full">
				<div className="relative rounded-xl overflow-hidden bg-gray-950 shadow-md">
					<video
						src={videoPayload.video_url}
						controls
						className="w-full rounded-xl"
						preload="metadata"
					/>
					{videoPayload.billable_duration != null && (
						<span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2 py-1 rounded-md">
							<Clock size={10} />
							{videoPayload.billable_duration}s
						</span>
					)}
				</div>
			</div>
		);
	}

	// When the parent already renders file cards from the `files` prop,
	// erase every file reference from the text so nothing duplicates above
	// the card. If nothing remains, render nothing.
	if (skipFileDetect) {
		const cleaned = eraseFileReferences(content);
		if (!cleaned) return null;
		return (
			<div className="message-content min-w-0 max-w-full w-full [overflow-wrap:anywhere]">
				<MarkdownBlock content={cleaned} />
			</div>
		);
	}

	// Split content into text and file-block segments.
	const segments = parseSegments(content);

	// Fast path: single text segment (the common case).
	if (segments.length === 1 && segments[0].kind === "text") {
		return (
			<div className="message-content min-w-0 max-w-full w-full [overflow-wrap:anywhere]">
				<MarkdownBlock content={segments[0].content} />
			</div>
		);
	}

	return (
		<div className="message-content min-w-0 max-w-full w-full [overflow-wrap:anywhere]">
			{segments.map((seg, i) =>
				seg.kind === "file" ? (
					<div key={`file-${i}`} className="my-3">
						<FileAttachmentCard {...seg.data} />
					</div>
				) : (
					<MarkdownBlock key={`text-${i}`} content={seg.content} />
				),
			)}
		</div>
	);
}
