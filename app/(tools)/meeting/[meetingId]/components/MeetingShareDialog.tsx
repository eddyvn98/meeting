"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Share2, X } from "lucide-react";
import type { MeetingShare } from "@/lib/meeting/types";
import type { MeetingShareRole } from "@/lib/meeting/shareTypes";
import { MeetingPublicLinkSection } from "./MeetingPublicLinkSection";

function isActive(share: MeetingShare): boolean {
	if (share.revokedAt) return false;
	if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) return false;
	return true;
}

function statusLabel(share: MeetingShare): string {
	if (share.revokedAt) return "Revoked";
	if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) return "Expired";
	if (share.expiresAt) return `Until ${new Date(share.expiresAt).toLocaleDateString()}`;
	return "No expiry";
}

/**
 * "Share" button + popover in the Meeting Result header (and reused on the
 * Minutes page): invite by company email with a viewer/editor role and an
 * optional expiry date, list current grants with their status, change a
 * grant's role, and revoke one. Owner-only — every caller only renders this
 * when `accessRole === "owner"` (see MeetingResultHeader.tsx / the Minutes
 * page); an editor sees the edit UI but never share management, same as
 * the workspace Share dialog's owner-only gate.
 *
 * A shared viewer gets read access to the Overview/Transcript/Ask tabs and
 * their OWN Ask conversation (never the owner's — see ask/route.ts's doc
 * comment: Ask history is never persisted server-side at all) and can run
 * translations themselves (reusing the already-generated one, or a
 * different target language — see translate/route.ts). A shared editor
 * additionally gets sections CRUD, summary/minutes PATCH, and minutes
 * generate — see app/api/meeting/[meetingId]/sections/_shared.ts's
 * requireMeetingEditor.
 */
export function MeetingShareDialog({
	meetingId,
	open: controlledOpen,
	onOpenChange,
	iconOnly = false,
}: {
	meetingId: string;
	/** Show only the share icon (with a tooltip-style title) instead of the "Share" label. */
	iconOnly?: boolean;
	/** Controlled mode: shows the panel as a dialog with no trigger button, so
	 *  a parent menu can open it. Omit for the self-contained button + popover. */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}) {
	const controlled = controlledOpen !== undefined;
	const [innerOpen, setInnerOpen] = useState(false);
	const open = controlled ? controlledOpen : innerOpen;
	const setOpen = (value: boolean | ((prev: boolean) => boolean)) => {
		const next = typeof value === "function" ? value(open) : value;
		if (controlled) onOpenChange?.(next);
		else setInnerOpen(next);
	};	const [shares, setShares] = useState<MeetingShare[] | null>(null);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<MeetingShareRole>("viewer");
	const [expiresAt, setExpiresAt] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadShares = useCallback(() => {
		fetch(`/api/meeting/${meetingId}/shares`)
			.then((res) => (res.ok ? (res.json() as Promise<MeetingShare[]>) : null))
			.then((data) => {
				if (data) setShares(data);
			})
			.catch(() => undefined);
	}, [meetingId]);

	useEffect(() => {
		if (open) loadShares();
	}, [loadShares, open]);

	const handleInvite = async () => {
		const trimmed = email.trim();
		if (!trimmed || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch(`/api/meeting/${meetingId}/shares`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: trimmed, role, expiresAt: expiresAt || null }),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				// 422 user_not_found carries a friendlier `message`; other failures
				// carry `error`.
				throw new Error(data?.message ?? data?.error ?? `Failed (${res.status})`);
			}
			setEmail("");
			setExpiresAt("");
			loadShares();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to share");
		} finally {
			setSubmitting(false);
		}
	};

	const handleRoleChange = async (shareId: string, nextRole: MeetingShareRole) => {
		setError(null);
		const previousShares = shares;
		setShares((prev) => prev?.map((s) => (s.id === shareId ? { ...s, role: nextRole } : s)) ?? prev);
		try {
			const res = await fetch(`/api/meeting/${meetingId}/shares/${shareId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ role: nextRole }),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error ?? `Failed (${res.status})`);
			}
		} catch (err) {
			setShares(previousShares);
			setError(err instanceof Error ? err.message : "Could not change role");
		}
	};

	const handleRevoke = async (shareId: string) => {
		setShares((prev) => prev?.map((s) => (s.id === shareId ? { ...s, revokedAt: new Date().toISOString() } : s)) ?? prev);
		await fetch(`/api/meeting/${meetingId}/shares/${shareId}`, { method: "DELETE" }).catch(() => undefined);
	};

	const panel = (
					<div className={controlled ? "" : "absolute right-0 top-full z-20 mt-1.5 w-80 rounded-lg border border-border bg-card p-3 shadow-lg"}>
						<div className="mb-2 flex items-center justify-between">
							<p className="text-xs font-medium text-muted-foreground">Share this meeting</p>
							{!controlled && (<button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
								<X className="h-3.5 w-3.5" />
							</button>)}
						</div>

						<div className="flex flex-col gap-1.5">
							<div className="flex items-center gap-1.5">
								<input
									type="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="colleague@company.com"
									className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none"
								/>
								<select
									value={role}
									onChange={(e) => setRole(e.target.value as MeetingShareRole)}
									aria-label="Role"
									className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium text-foreground outline-none"
								>
									<option value="viewer">Can view</option>
									<option value="editor">Can edit</option>
								</select>
							</div>
							<div className="flex items-center gap-1.5">
								<input
									type="date"
									value={expiresAt}
									onChange={(e) => setExpiresAt(e.target.value)}
									aria-label="Expires on (optional)"
									className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none"
								/>
								<button
									type="button"
									onClick={handleInvite}
									disabled={submitting || !email.trim()}
									className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
								>
									{submitting && <Loader2 className="h-3 w-3 animate-spin" />}
									Invite
								</button>
							</div>
							<p className="text-[11px] text-muted-foreground">Leave the date empty for no expiry.</p>
						</div>
						{error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}

						<div className="mt-3 flex flex-col gap-1 border-t border-border pt-2">
							{shares === null ? (
								<p className="text-xs text-muted-foreground">Loading…</p>
							) : shares.length === 0 ? (
								<p className="text-xs text-muted-foreground">Not shared with anyone yet.</p>
							) : (
								shares.map((share) => {
									const active = isActive(share);
									return (
										<div key={share.id} className="flex items-center justify-between gap-2 text-xs">
											<div className="min-w-0">
												<p className={`truncate font-medium ${active ? "text-foreground" : "text-muted-foreground line-through"}`}>
													{share.invitedEmail}
												</p>
												<p className="text-muted-foreground">{statusLabel(share)}</p>
											</div>
											{active && (
												<div className="flex shrink-0 items-center gap-1.5">
													<select
														value={share.role}
														onChange={(e) => handleRoleChange(share.id, e.target.value as MeetingShareRole)}
														aria-label={`Role for ${share.invitedEmail}`}
														className="rounded border border-border bg-background px-1.5 py-1 text-[11px] font-medium text-foreground outline-none"
													>
														<option value="viewer">Can view</option>
														<option value="editor">Can edit</option>
													</select>
													<button
														type="button"
														onClick={() => handleRevoke(share.id)}
														className="shrink-0 rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
													>
														Revoke
													</button>
												</div>
											)}
										</div>
									);
								})
							)}
						</div>
						<MeetingPublicLinkSection meetingId={meetingId} />
					</div>
	);

	if (controlled) {
		return (
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm">
					<DialogTitle className="sr-only">Share this meeting</DialogTitle>
					{panel}
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-label="Share"
				title={iconOnly ? "Share" : undefined}
				aria-expanded={open}
				className={`flex items-center gap-1.5 rounded-md border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted ${iconOnly ? "h-8 w-8 justify-center" : "px-3 py-1.5"}`}
			>
				<Share2 className="h-3.5 w-3.5" />
				{!iconOnly && "Share"}
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
					{panel}
				</>
			)}
		</div>
	);
}
