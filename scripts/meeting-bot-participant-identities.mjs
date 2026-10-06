import {
  captureIdentityScreenshot,
  logIdentityDiagnostic,
} from "./meeting-bot-identity-diagnostics.mjs";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function extractEmailsFromText(value) {
  if (typeof value !== "string" || !value) return [];
  const found = value.match(EMAIL_RE) || [];
  return [...new Set(found.map((email) => email.trim().toLowerCase()))];
}

export function teamsJoinIdentity(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"].includes(host)) return null;
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "").toLowerCase();
    return path ? `${host}${path}` : null;
  } catch {
    return null;
  }
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
  sessionId = "unknown",
  onParticipantProbed,
} = {}) {
  if (!page || page.isClosed()) {
    logIdentityDiagnostic(sessionId, "teams", "PAGE_CLOSED", {}, "warn");
    return [];
  }

  logIdentityDiagnostic(sessionId, "teams", "PROBE_START", {
    participants: participantNames.length,
    maxProfiles,
  });

  const emails = new Set();
  const roster = page.locator([
    '[data-tid*="roster" i]:visible',
    '[aria-label*="participants" i]:visible',
    '[aria-label*="people" i]:visible',
  ].join(",")).first();
  const rosterVisible = await roster.isVisible().catch(() => false);
  if (rosterVisible) {
    const directEmails = await emailsFromLocator(roster);
    mergeEmails(emails, directEmails);
    logIdentityDiagnostic(sessionId, "teams", "ROSTER_VISIBLE", {
      directEmails: directEmails.length,
    });
  } else {
    logIdentityDiagnostic(sessionId, "teams", "ROSTER_NOT_VISIBLE", {}, "warn");
    await captureIdentityScreenshot(page, sessionId, "teams-roster-not-visible");
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
    if (!await rowText.isVisible().catch(() => false)) {
      logIdentityDiagnostic(sessionId, "teams", "PARTICIPANT_ROW_NOT_VISIBLE", {
        participant: name,
      }, "warn");
      continue;
    }

    probed += 1;
    const before = emails.size;
    const clicked = await rowText.click({ timeout: 2_000 })
      .then(() => true)
      .catch((error) => {
        logIdentityDiagnostic(sessionId, "teams", "PROFILE_OPEN_FAILED", {
          participant: name,
          error: error instanceof Error ? error.message : String(error),
        }, "warn");
        return false;
      });
    if (!clicked) {
      onParticipantProbed?.(name, { foundEmail: false });
      await captureIdentityScreenshot(page, sessionId, "teams-profile-open-failed");
      continue;
    }
    await page.waitForTimeout(250).catch(() => undefined);

    const cards = visibleProfileContainers(page);
    const cardCount = Math.min(await cards.count().catch(() => 0), 5);
    if (cardCount === 0) {
      logIdentityDiagnostic(sessionId, "teams", "PROFILE_CARD_NOT_VISIBLE", {
        participant: name,
      }, "warn");
    }
    for (let index = 0; index < cardCount; index += 1) {
      const card = cards.nth(index);
      if (!await card.isVisible().catch(() => false)) continue;
      mergeEmails(emails, await emailsFromLocator(card));
    }

    await page.keyboard.press("Escape").catch(() => undefined);
    if (emails.size === before) {
      onParticipantProbed?.(name, { foundEmail: false });
      logIdentityDiagnostic(sessionId, "teams", "PROFILE_CARD_NO_EMAIL", {
        participant: name,
        cards: cardCount,
      }, "warn");
      continue;
    }
    onParticipantProbed?.(name, { foundEmail: true });
    logIdentityDiagnostic(sessionId, "teams", "PROFILE_EMAIL_FOUND", {
      participant: name,
      newEmails: emails.size - before,
    });
  }

  logIdentityDiagnostic(sessionId, "teams", emails.size > 0 ? "PROBE_SUCCESS" : "PROBE_EMPTY", {
    emails: emails.size,
    profilesProbed: probed,
  }, emails.size > 0 ? "log" : "warn");
  if (emails.size === 0) {
    await captureIdentityScreenshot(page, sessionId, "teams-no-participant-email");
  }
  return [...emails];
}

async function outlookAttendeeEmails(dialog) {
  const result = new Set();

  // Prefer explicit mailto links: these are strong identity signals and avoid
  // accidentally reading arbitrary email-like text from the meeting body.
  const mailtoLinks = dialog.locator('a[href^="mailto:" i]');
  const mailtoCount = Math.min(await mailtoLinks.count().catch(() => 0), 300);
  for (let index = 0; index < mailtoCount; index += 1) {
    const href = await mailtoLinks.nth(index).getAttribute("href").catch(() => null);
    const email = extractEmailsFromText(href || "")[0];
    if (email) result.add(email);
  }

  // Outlook sometimes renders attendee identities as plain text inside
  // attendee/persona/recipient rows instead of mailto anchors. Restrict this
  // fallback to semantic attendee-like containers rather than the whole event.
  const rows = dialog.locator([
    '[data-automationid*="attendee" i]',
    '[data-testid*="attendee" i]',
    '[data-automationid*="persona" i]',
    '[data-testid*="persona" i]',
    '[data-automationid*="recipient" i]',
    '[data-testid*="recipient" i]',
    '[role="listitem"]',
    '[role="option"]',
  ].join(","));
  const rowCount = Math.min(await rows.count().catch(() => 0), 500);
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    if (!await row.isVisible().catch(() => false)) continue;
    mergeEmails(result, await emailsFromLocator(row, 10));
  }

  return [...result];
}

async function clickFirstVisible(locator) {
  const count = Math.min(await locator.count().catch(() => 0), 20);
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (!await item.isVisible().catch(() => false)) continue;
    const clicked = await item.click({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (clicked) return true;
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
  const sessionId = session?.id || "unknown";
  if (!context || !session?.title) {
    logIdentityDiagnostic(sessionId, "outlook", "MISSING_CONTEXT_OR_TITLE", {}, "warn");
    return [];
  }
  logIdentityDiagnostic(sessionId, "outlook", "PROBE_START", {
    title: session.title,
  });
  const page = await context.newPage().catch((error) => {
    logIdentityDiagnostic(sessionId, "outlook", "PAGE_CREATE_FAILED", {
      error: error instanceof Error ? error.message : String(error),
    }, "warn");
    return null;
  });
  if (!page) return [];

  try {
    await page.goto("https://outlook.office.com/calendar/view/day", {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    if (/login\.(?:microsoftonline|live)\.com/i.test(page.url())) {
      logIdentityDiagnostic(sessionId, "outlook", "AUTH_REQUIRED", {}, "warn");
      await captureIdentityScreenshot(page, sessionId, "outlook-auth-required");
      return [];
    }

    const exact = page.getByText(session.title, { exact: true });
    let opened = await clickFirstVisible(exact);
    if (!opened) {
      const partial = page.getByText(session.title, { exact: false });
      opened = await clickFirstVisible(partial);
    }
    if (!opened) {
      logIdentityDiagnostic(sessionId, "outlook", "EVENT_NOT_FOUND", { title: session.title }, "warn");
      await captureIdentityScreenshot(page, sessionId, "outlook-event-not-found");
      return [];
    }
    logIdentityDiagnostic(sessionId, "outlook", "EVENT_OPENED", { title: session.title });

    await page.waitForTimeout(400).catch(() => undefined);

    // Expand attendee details when Outlook exposes a semantic button.
    const expand = page.getByRole("button", {
      name: /show all|view all|attendees|participants|người tham dự|người tham gia/i,
    });
    const expanded = await clickFirstVisible(expand).catch(() => false);
    logIdentityDiagnostic(sessionId, "outlook", expanded ? "ATTENDEES_EXPANDED" : "ATTENDEES_EXPAND_NOT_FOUND");
    await page.waitForTimeout(200).catch(() => undefined);

    const dialogs = page.locator('[role="dialog"]:visible');
    const expectedJoinIdentity = teamsJoinIdentity(session.meetingUrl);
    if (!expectedJoinIdentity) {
      logIdentityDiagnostic(sessionId, "outlook", "INVALID_SESSION_JOIN_URL", {}, "warn");
      return [];
    }

    const emails = new Set();
    let matchedMeeting = false;
    const dialogCount = Math.min(await dialogs.count().catch(() => 0), 5);
    for (let index = 0; index < dialogCount; index += 1) {
      const dialog = dialogs.nth(index);
      const joinLinks = dialog.locator(
        'a[href*="teams.microsoft.com" i], a[href*="teams.live.com" i], a[href*="teams.cloud.microsoft" i]',
      );
      const joinCount = Math.min(await joinLinks.count().catch(() => 0), 20);
      let thisDialogMatches = false;
      for (let linkIndex = 0; linkIndex < joinCount; linkIndex += 1) {
        const href = await joinLinks.nth(linkIndex).getAttribute("href").catch(() => null);
        if (teamsJoinIdentity(href) === expectedJoinIdentity) {
          matchedMeeting = true;
          thisDialogMatches = true;
          break;
        }
      }
      if (!thisDialogMatches) continue;

      const attendeeEmails = await outlookAttendeeEmails(dialog);
      mergeEmails(emails, attendeeEmails);
      logIdentityDiagnostic(sessionId, "outlook", "INVITEE_EMAILS_EXTRACTED", {
        emails: attendeeEmails.length,
      });
    }

    // Title alone is not an authorization identity: duplicate meeting titles
    // are common. Refuse Outlook-derived emails unless the event's Teams join
    // URL matches the bot session. Once verified, the event invitation list is
    // allowed to grant shared-room access even to invitees who never join.
    if (!matchedMeeting) {
      logIdentityDiagnostic(sessionId, "outlook", "JOIN_URL_MISMATCH", {
        dialogs: dialogCount,
      }, "warn");
      await captureIdentityScreenshot(page, sessionId, "outlook-join-url-mismatch");
      return [];
    }
    logIdentityDiagnostic(sessionId, "outlook", emails.size > 0 ? "PROBE_SUCCESS" : "VERIFIED_EVENT_NO_EMAIL", {
      emails: emails.size,
      dialogs: dialogCount,
    }, emails.size > 0 ? "log" : "warn");
    if (emails.size === 0) {
      await captureIdentityScreenshot(page, sessionId, "outlook-verified-event-no-email");
    }
    return [...emails];
  } catch (error) {
    logIdentityDiagnostic(sessionId, "outlook", "PROBE_EXCEPTION", {
      error: error instanceof Error ? error.message : String(error),
    }, "warn");
    await captureIdentityScreenshot(page, sessionId, "outlook-probe-exception");
    return [];
  } finally {
    await page.close().catch(() => undefined);
  }
}
