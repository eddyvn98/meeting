const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function extractEmailsFromText(value) {
  if (typeof value !== "string" || !value) return [];
  const found = value.match(EMAIL_RE) || [];
  return [...new Set(found.map((email) => email.trim().toLowerCase()))];
}

function mergeEmails(target, values) {
  for (const value of values) {
    if (value) target.add(value.toLowerCase());
  }
}

async function emailsFromLocator(locator, maxLinks = 100) {
  const result = new Set();
  const links = locator.locator('a[href^="mailto:" i]');
  const count = Math.min(await links.count().catch(() => 0), maxLinks);
  for (let index = 0; index < count; index += 1) {
    const href = await links.nth(index).getAttribute("href").catch(() => null);
    if (!href) continue;
    const raw = href.replace(/^mailto:/i, "").split("?")[0] || "";
    mergeEmails(result, extractEmailsFromText(raw));
  }
  const text = await locator.innerText().catch(() => "");
  mergeEmails(result, extractEmailsFromText(text));
  return [...result];
}

function visibleProfileContainers(page) {
  return page.locator([
    '[role="dialog"]:visible',
    '[data-tid*="profile-card" i]:visible',
    '[data-tid*="people-card" i]:visible',
    '[data-tid*="persona" i]:visible',
    '[data-tid*="contact-card" i]:visible',
  ].join(","));
}

/**
 * Best-effort identity extraction from the Teams People panel.
 *
 * It never guesses addresses from display names. It only accepts email
 * addresses visibly exposed by Teams itself, either directly in the roster
 * or in a participant profile/contact card opened from the roster.
 */
export async function readTeamsParticipantEmails(page, {
  participantNames = [],
  maxProfiles = 6,
} = {}) {
  if (!page || page.isClosed()) return [];

  const emails = new Set();
  const roster = page.locator([
    '[data-tid*="roster" i]:visible',
    '[aria-label*="participants" i]:visible',
    '[aria-label*="people" i]:visible',
  ].join(",")).first();
  if (await roster.isVisible().catch(() => false)) {
    mergeEmails(emails, await emailsFromLocator(roster));
  }

  let probed = 0;
  for (const rawName of participantNames) {
    if (probed >= maxProfiles) break;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) continue;

    const rosterScoped = await roster.isVisible().catch(() => false)
      ? roster.getByText(name, { exact: true }).first()
      : null;
    const rowText =
      rosterScoped && await rosterScoped.isVisible().catch(() => false)
        ? rosterScoped
        : page.getByText(name, { exact: true }).first();
    if (!await rowText.isVisible().catch(() => false)) continue;

    probed += 1;
    const before = emails.size;
    await rowText.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(250).catch(() => undefined);

    const cards = visibleProfileContainers(page);
    const cardCount = Math.min(await cards.count().catch(() => 0), 5);
    for (let index = 0; index < cardCount; index += 1) {
      const card = cards.nth(index);
      if (!await card.isVisible().catch(() => false)) continue;
      mergeEmails(emails, await emailsFromLocator(card));
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    if (emails.size === before) {
      // No email was exposed for this participant; do not infer one.
      continue;
    }
  }

  return [...emails];
}

async function clickFirstVisible(locator) {
  const count = Math.min(await locator.count().catch(() => 0), 20);
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!await item.isVisible().catch(() => false)) continue;
    await item.click({ timeout: 2_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

/**
 * Authenticated-browser fallback: open Outlook Web in a second tab, find the
 * current meeting by title, open its event card, and read only email
 * addresses visibly exposed by that UI. Failure is intentionally silent so
 * calendar scraping can never interrupt recording/STT.
 */
export async function readOutlookMeetingAttendeeEmails(context, session, {
  timeoutMs = 15_000,
} = {}) {
  if (!context || !session?.title) return [];
  const page = await context.newPage().catch(() => null);
  if (!page) return [];

  try {
    await page.goto("https://outlook.office.com/calendar/view/day", {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    if (/login\.(?:microsoftonline|live)\.com/i.test(page.url())) return [];

    const exact = page.getByText(session.title, { exact: true });
    let opened = await clickFirstVisible(exact);
    if (!opened) {
      const partial = page.getByText(session.title, { exact: false });
      opened = await clickFirstVisible(partial);
    }
    if (!opened) return [];

    await page.waitForTimeout(400).catch(() => undefined);

    // Expand attendee details when Outlook exposes a semantic button.
    const expand = page.getByRole("button", {
      name: /show all|view all|attendees|participants|người tham dự|người tham gia/i,
    });
    await clickFirstVisible(expand).catch(() => false);
    await page.waitForTimeout(200).catch(() => undefined);

    const dialogs = page.locator('[role="dialog"]:visible');
    const emails = new Set();
    const dialogCount = Math.min(await dialogs.count().catch(() => 0), 5);
    for (let index = 0; index < dialogCount; index += 1) {
      mergeEmails(emails, await emailsFromLocator(dialogs.nth(index)));
    }

    return [...emails];
  } catch {
    return [];
  } finally {
    await page.close().catch(() => undefined);
  }
}
