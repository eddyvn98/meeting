import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Same session-resolution shape as app/api/workspaces/_auth.ts and
 * app/api/mindmaps/_auth.ts, duplicated rather than imported so this feature
 * stays independent of the others (same convention every tool in this repo
 * follows). Email IS the identity here (no users table); the resolved
 * address is always lower-cased and trimmed so the same person is never
 * stored as two identities.
 */
const canonical = (email: string) => email.trim().toLowerCase();

export async function resolveMeetingCallerEmail(req: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV !== "production") {
    const mockEmailCookie = req.cookies.get("mock-email")?.value;
    if (mockEmailCookie?.trim()) return canonical(mockEmailCookie);
  }

  const token = await getToken({ req });
  if (typeof token?.email === "string" && token.email.trim()) {
    return canonical(token.email);
  }

  if (process.env.NODE_ENV !== "production") {
    return canonical(
      process.env.NEXT_PUBLIC_DEV_USER_EMAIL
        ?? process.env.NEXT_PUBLIC_FINANCE_DEV_EMAIL
        ?? "user@company.com",
    );
  }

  return null;
}
