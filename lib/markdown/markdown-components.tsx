import React, { Children, isValidElement } from "react";
import CodeBlock from "@/lib/markdown/code-helper";
import { Download } from "lucide-react";
import { MindmapPreviewCard } from "@/components/features/chat/mindmap/mindmap-preview-card";

/** Mark fenced code nodes because react-markdown 10 no longer passes `inline`. */
export function markFencedCodeBlocks() {
	return (tree: any) => {
		const walk = (node: any, parent: any) => {
			if (
				node?.type === "element" &&
				node.tagName === "code" &&
				parent?.type === "element" &&
				parent.tagName === "pre"
			) {
				node.properties = {
					...(node.properties ?? {}),
					"data-code-block": "true",
				};
			}

			for (const child of node?.children ?? []) walk(child, node);
		};

		walk(tree, null);
	};
}

export const markdownComponents = {
	h1: ({ children }: any) => (
		<h1 className="text-[19px] sm:text-[21px] font-bold mt-8 mb-3 leading-[1.3] tracking-[-0.015em] text-gray-900 dark:text-gray-50 first:mt-0 pb-2.5 border-b border-gray-200/80 dark:border-gray-700/40 break-words min-w-0">
			{children}
		</h1>
	),
	h2: ({ children }: any) => (
		<h2 className="text-[16px] sm:text-[18px] font-semibold mt-7 mb-2.5 leading-[1.35] tracking-[-0.01em] text-gray-900 dark:text-gray-100 first:mt-0 break-words min-w-0">
			{children}
		</h2>
	),
	h3: ({ children }: any) => (
		<h3 className="text-[14px] sm:text-[15px] font-semibold mt-5 mb-2 leading-[1.4] text-gray-800 dark:text-gray-200 first:mt-0 break-words min-w-0">
			{children}
		</h3>
	),
	h4: ({ children }: any) => (
		<h4 className="text-[14px] font-semibold mt-4 mb-1.5 leading-[1.4] text-gray-800 dark:text-gray-200 first:mt-0 break-words min-w-0">
			{children}
		</h4>
	),
	h5: ({ children }: any) => (
		<h5 className="text-[13px] font-medium mt-3 mb-1.5 leading-[1.4] text-gray-700 dark:text-gray-300 first:mt-0 break-words min-w-0">
			{children}
		</h5>
	),
	h6: ({ children }: any) => (
		<h6 className="text-[11px] font-semibold mt-3 mb-1.5 leading-[1.4] uppercase tracking-wider text-gray-500 dark:text-gray-400 first:mt-0 break-words min-w-0">
			{children}
		</h6>
	),
	p: ({ children }: any) => {
		const hasBlockChild = Children.toArray(children).some(
			(child) => isValidElement(child) && (child.type === CodeBlock || child.type === MindmapPreviewCard),
		);
		const Tag = hasBlockChild ? "div" : "p";
		return (
			<Tag className="text-[15px] text-gray-800 dark:text-gray-200 leading-[1.85] my-3 first:mt-0 last:mb-0 break-words [overflow-wrap:anywhere] min-w-0">
				{children}
			</Tag>
		);
	},
	strong: ({ children }: any) => (
		<strong className="font-semibold text-gray-900 dark:text-gray-100">{children}</strong>
	),
	em: ({ children }: any) => (
		<em className="italic text-gray-800 dark:text-gray-200">{children}</em>
	),
	blockquote: ({ children }: any) => (
		<blockquote className="relative my-4 pl-4 pr-3 py-3 border-l-[3px] border-orange-400/90 dark:border-orange-500/70 bg-orange-50/50 dark:bg-orange-950/10 rounded-r-xl text-[15px] leading-[1.8] text-gray-700 dark:text-gray-300 min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere]">
			{children}
		</blockquote>
	),
	ul: ({ children }: any) => (
		<ul className="mt-2 mb-4 pl-4 space-y-1.5 text-gray-800 dark:text-gray-200 list-disc marker:text-[0.85em] marker:text-gray-400/80 dark:marker:text-gray-600 first:mt-0 last:mb-0 min-w-0 max-w-full [&_ul]:mt-1.5 [&_ul]:mb-0 [&_ol]:mt-1.5 [&_ol]:mb-0">
			{children}
		</ul>
	),
	ol: ({ children }: any) => (
		<ol className="mt-2 mb-4 pl-4 space-y-1.5 text-gray-800 dark:text-gray-200 list-decimal marker:text-[0.85em] marker:text-gray-400/80 dark:marker:text-gray-600 first:mt-0 last:mb-0 min-w-0 max-w-full [&_ul]:mt-1.5 [&_ul]:mb-0 [&_ol]:mt-1.5 [&_ol]:mb-0">
			{children}
		</ol>
	),
	li: ({ children }: any) => (
		<li className="text-[15px] leading-[1.8] pl-1 break-words [overflow-wrap:anywhere] min-w-0">{children}</li>
	),
	table: ({ children }: any) => (
		<div className="w-full max-w-full min-w-0 overflow-x-auto my-5 rounded-xl border border-gray-200/80 dark:border-gray-700/50 shadow-sm isolate">
			<table className="min-w-full border-collapse text-[14px]">{children}</table>
		</div>
	),
	thead: ({ children }: any) => (
		<thead className="bg-gray-50/80 dark:bg-slate-800/70 border-b border-gray-200/80 dark:border-gray-700/50">{children}</thead>
	),
	tbody: ({ children }: any) => (
		<tbody className="divide-y divide-gray-100/80 dark:divide-gray-800/60">{children}</tbody>
	),
	th: ({ children }: any) => (
		<th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap">{children}</th>
	),
	td: ({ children }: any) => (
		<td className="px-4 py-2.5 text-[14px] text-gray-700 dark:text-gray-300 align-top break-words [overflow-wrap:anywhere]">{children}</td>
	),
	code({ className, children, node, ...props }: any) {
		const language = className?.replace("language-", "");
		const rawCode = Array.isArray(children) ? children.join("") : String(children);
		const isBlock = node?.properties?.["data-code-block"] === "true";

		if (!isBlock) {
			return (
				<code
					className="px-1.5 py-[3px] rounded-md font-mono text-[0.85em] bg-gray-100 dark:bg-gray-800/80 text-orange-600 dark:text-orange-400 border border-gray-200/60 dark:border-gray-700/40 break-all"
					{...props}
				>
					{children}
				</code>
			);
		}

		if (language === "mindmap") {
			return <MindmapPreviewCard code={rawCode.replace(/\n$/, "")} />;
		}

		return <CodeBlock language={language} code={rawCode.replace(/\n$/, "")} />;
	},
	a({ href, children }: any) {
		const imageRegex = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)(\?.*)?$/i;
		if (href && imageRegex.test(href)) {
			return (
				<div className="flex flex-col gap-2 my-4 min-w-0 max-w-full">
					{children !== href && <span className="text-[13px] font-medium text-blue-600 dark:text-blue-400 break-words [overflow-wrap:anywhere]">{children}</span>}
					<div className="relative group w-fit max-w-full min-w-0">
						<img src={href} alt={typeof children === "string" ? children : "Image"} className="max-w-full w-auto h-auto block rounded-xl shadow-sm" />
						<a href={href} download className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white text-[11px] px-2 py-1.5 rounded-lg flex items-center gap-1.5"><Download size={11} /> Save</a>
					</div>
				</div>
			);
		}

		return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 decoration-blue-300/60 dark:decoration-blue-700/60 hover:decoration-blue-500 dark:hover:decoration-blue-400 transition-colors duration-150 break-all">{children}</a>;
	},
	img: ({ src, alt }: any) => (
		<div className="relative my-4 group w-fit max-w-full min-w-0">
			<img src={src} alt={alt || "Image"} className="max-w-full w-auto h-auto block rounded-xl shadow-sm" />
			<a href={src} download className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-black/50 hover:bg-black/70 backdrop-blur-sm text-white text-[11px] px-2 py-1.5 rounded-lg flex items-center gap-1.5"><Download size={11} /> Save</a>
		</div>
	),
	hr: () => <hr className="my-6 border-0 h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700/70 to-transparent" />,
	pre: ({ children }: any) => <div className="my-0 w-full max-w-full min-w-0 overflow-x-auto">{children}</div>,
};
