export interface GraphUser {
	id: string;
	accountEnabled: boolean | null;
	displayName: string;
	givenName: string | null;
	surname: string | null;
	mail: string | null;
	userPrincipalName: string;
	jobTitle: string | null;
	department: string | null;
	companyName: string | null;
	createdDateTime: string | null;
	onPremisesSamAccountName: string | null;
	onPremisesUserPrincipalName: string | null;
}

export async function getGraphMe(accessToken: string): Promise<GraphUser> {
	const url = new URL("https://graph.microsoft.com/v1.0/me");

	url.searchParams.set(
		"$select",
		[
			"id",
			"accountEnabled",
			"displayName",
			"givenName",
			"surname",
			"mail",
			"userPrincipalName",
			"jobTitle",
			"department",
			"companyName",
			"createdDateTime",
			"onPremisesSamAccountName",
			"onPremisesUserPrincipalName",
		].join(","),
	);

	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
		cache: "no-store",
	});

	if (!res.ok) {
		const responseBody = await res.text();

		console.error("[graph][me-failed]", {
			status: res.status,
			statusText: res.statusText,
			responseBody,
		});

		throw new Error(`Graph API failed: ${res.status} ${res.statusText}`);
	}

	return (await res.json()) as GraphUser;
}

// Azure AD's `mail` and `userPrincipalName` claims can differ in case between
// logins (or from the ID token's own email/preferred_username/upn claims), so
// every DB lookup/write and every session email must go through this to keep
// resolving to the same sch_ms_users record across logout/login cycles.
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function deriveEmail(user: GraphUser): string {
	return normalizeEmail(user.mail ?? user.userPrincipalName);
}
