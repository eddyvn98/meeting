// Shared local embedding helper — all-MiniLM-L6-v2 via @xenova/transformers.
// Runs in-process (WASM), no embedding-provider API key needed. Originally
// written inline in lib/vector-store.ts for project knowledge search;
// extracted here so lib/mindmap/knowledge-repository.ts can reuse the same
// model/pipeline singleton instead of loading a second copy into memory.

let pipelinePromise: Promise<(text: string, opts: object) => Promise<{ data: Float32Array }>> | null = null;

async function getEmbedder() {
	if (!pipelinePromise) {
		pipelinePromise = (async () => {
			const { pipeline } = await import("@xenova/transformers");
			return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
				quantized: true,
			}) as unknown as (text: string, opts: object) => Promise<{ data: Float32Array }>;
		})();
		// Reset singleton on failure so the next call can retry.
		pipelinePromise.catch(() => { pipelinePromise = null; });
	}
	return pipelinePromise;
}

/** 384-dim embedding vector, mean-pooled and L2-normalized. */
export async function embed(text: string): Promise<number[]> {
	const embedder = await getEmbedder();
	const output = await embedder(text, { pooling: "mean", normalize: true });
	return Array.from(output.data);
}

export function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
