const SELF_RE = /\b(?:you|bạn)\b/i;
const SPEAKING_RE = /\b(?:speaking|is speaking|currently speaking|đang nói)\b/i;
const STATUS_RE = /^(?:muted|unmuted|organizer|presenter|attendee|guest|you|microphone.*|camera.*|đã tắt tiếng|bật tiếng|người tổ chức|người trình bày|người tham dự|khách|bạn)$/i;
const NOISE_RE = /^(?:people|participants|người tham gia|invite someone|share invite|meeting chat|more)$/i;

export function cleanRosterName(raw) {
  if (typeof raw !== "string") return null;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\((?:you|bạn|guest|khách)\)/gi, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    if (STATUS_RE.test(line) || NOISE_RE.test(line)) continue;
    const cleaned = line
      .replace(/\s+[·|,-]\s*(?:muted|unmuted|organizer|presenter|attendee|guest|speaking|đang nói).*$/i, "")
      .trim();
    if (cleaned && !STATUS_RE.test(cleaned) && !NOISE_RE.test(cleaned)) return cleaned.slice(0, 160);
  }
  return null;
}

function normalize(value) {
  return value.trim().toLocaleLowerCase();
}

async function readEntry(locator) {
  const [text, aria, title] = await Promise.all([
    locator.innerText().catch(() => ""),
    locator.getAttribute("aria-label").catch(() => null),
    locator.getAttribute("title").catch(() => null),
  ]);
  const combined = [text, aria, title].filter(Boolean).join("\n");
  const speakingDescendant = await locator
    .locator(
      '[data-tid*="speaking"], [aria-label*="speaking" i], [title*="speaking" i], [aria-label*="đang nói" i], [title*="đang nói" i]',
    )
    .first()
    .isVisible()
    .catch(() => false);
  return {
    name: cleanRosterName(combined),
    self: SELF_RE.test(combined),
    speaking: speakingDescendant || SPEAKING_RE.test(combined),
  };
}

async function collectEntries(page, selector, max = 300) {
  const locator = page.locator(selector);
  const count = Math.min(await locator.count().catch(() => 0), max);
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(await readEntry(locator.nth(index)));
  }
  return rows;
}

/** Best-effort Teams Web roster snapshot. The People panel should already be
 * open. Selectors intentionally overlap because Teams changes data-tid names
 * between builds; the result is deduplicated by normalized display name. */
export async function readTeamsRosterSnapshot(page, { selfDisplayName } = {}) {
  if (page.isClosed()) return { participantNames: [], activeSpeakerNames: [] };

  let rows = await collectEntries(
    page,
    [
      '[data-tid="roster-participant"]',
      '[data-tid^="roster-participant"]',
      '[data-tid*="roster-participant"]',
      '[data-tid*="participant-item"]',
      '[data-tid*="participant-row"]',
    ].join(","),
  );

  if (rows.length === 0) {
    const fallback = await collectEntries(page, '[role="listitem"]', 200);
    rows = fallback.filter((row) => row.name && (row.self || row.speaking));
  }

  const selfKey = typeof selfDisplayName === "string" && selfDisplayName.trim()
    ? normalize(selfDisplayName)
    : null;
  const names = new Map();
  const active = new Map();

  for (const row of rows) {
    if (!row.name || row.self) continue;
    const key = normalize(row.name);
    if (selfKey && key === selfKey) continue;
    if (!names.has(key)) names.set(key, row.name);
    if (row.speaking && !active.has(key)) active.set(key, row.name);
  }

  return {
    participantNames: [...names.values()],
    activeSpeakerNames: [...active.values()].slice(0, 4),
  };
}
