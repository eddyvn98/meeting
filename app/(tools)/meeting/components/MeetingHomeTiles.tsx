import type { ReactNode } from "react";

/**
 * One Home action: the big button on top, and the options that apply to that
 * action underneath, so it is obvious which settings belong to what.
 */
export function ActionTile({
	icon,
	title,
	subtitle,
	onClick,
	disabled,
	children,
}: {
	icon: ReactNode;
	title: string;
	subtitle: string;
	onClick?: () => void;
	disabled?: boolean;
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col">
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				className="flex flex-col items-center gap-2 px-6 py-8 text-center transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
			>
				<span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-orange-light dark:bg-amber-950/30">
					{icon}
				</span>
				<span className="text-sm font-semibold text-foreground">{title}</span>
				<span className="text-xs text-muted-foreground">{subtitle}</span>
			</button>
			{children && (
				<div className="flex flex-1 flex-col gap-1.5 border-t border-border/70 bg-muted/20 px-5 py-3">
					{children}
				</div>
			)}
		</div>
	);
}
