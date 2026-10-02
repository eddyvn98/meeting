export async function resolveCloudLinkContent(text: string): Promise<string> {
	const DOC_EXT_PAT = "docx?|pdf|pptx?|xlsx?|md|txt";
	const TEXT_FILE_RE = new RegExp(
		`(?:\\[([^\\]]+\\.(?:${DOC_EXT_PAT}))\\]\\([^)\\n]*\\)|([^\\n\\r]+\\.(?:${DOC_EXT_PAT})))\\s*[\\n\\r]+Cloud Link[^\\n\\r]*:[\\s\\S]*?(https?:\\/\\/[^\\s\\n\\r]+)`,
		"gi"
	);

	TEXT_FILE_RE.lastIndex = 0;
	const match = TEXT_FILE_RE.exec(text);
	if (match) {
		const fileName = (match[1] ?? match[2] ?? "").trim();
		const fileUrl = (match[3] ?? "").trim();
		if ((fileName.toLowerCase().endsWith(".md") || fileName.toLowerCase().endsWith(".txt")) && fileUrl) {
			try {
				const proxyUrl = `/api/proxy/file/?url=${encodeURIComponent(fileUrl)}`;
				const res = await fetch(proxyUrl);
				if (res.ok) {
					const content = await res.text();
					if (content.trim()) {
						return content.trim();
					}
				}
			} catch (err) {
				console.error("Failed to fetch cloud link content:", err);
			}
		}
	} else {
		// Fallback to bare url if pattern A didn't match
		const bareUrlMatch = text.match(/https?:\/\/[^\s\n\r"']+\.(?:md|txt)(?:\?[^\s\n\r"']*)?/i);
		if (bareUrlMatch) {
			const fileUrl = bareUrlMatch[0];
			try {
				const proxyUrl = `/api/proxy/file/?url=${encodeURIComponent(fileUrl)}`;
				const res = await fetch(proxyUrl);
				if (res.ok) {
					const content = await res.text();
					if (content.trim()) {
						return content.trim();
					}
				}
			} catch (err) {
				console.error("Failed to fetch bare url content:", err);
			}
		}
	}
	return text;
}
