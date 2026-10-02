import { splitBilingual } from "@/lib/meeting/bilingualText";

/** Renders an Overview string; in the bilingual view the translated part goes
 *  on its own line, smaller and italic. */
export function BilingualText({ text }: { text: string }) {
	const { original, translated } = splitBilingual(text);
	if (translated === null) return <>{text}</>;
	return (
		<>
			{original}
			<span className="mt-0.5 block text-[0.85em] italic opacity-80">{translated}</span>
		</>
	);
}
