import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "@playwright/test";
import { resolveTeamsAuthStatePath } from "./meeting-bot-auth-state.mjs";
import { isTeamsAuthUrl } from "./meeting-bot-teams.mjs";

const authStatePath = resolveTeamsAuthStatePath();
const browserChannel = process.env.MEETING_BOT_BROWSER_CHANNEL || undefined;
const browserExecutable = process.env.MEETING_BOT_BROWSER_EXECUTABLE || undefined;

async function main() {
  await mkdir(dirname(authStatePath), { recursive: true });

  const browser = await chromium.launch({
    ...(browserChannel ? { channel: browserChannel } : {}),
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-notifications",
    ],
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const prompt = createInterface({ input, output });

  try {
    await page.goto("https://teams.microsoft.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    console.log("");
    console.log("[meeting-bot] Sign in to Microsoft/Teams in the opened browser.");
    console.log("[meeting-bot] Complete password, MFA and account selection manually.");
    console.log("[meeting-bot] Do not close the browser.");
    await prompt.question(
      "[meeting-bot] When Teams shows the signed-in account/home screen, press Enter here to save the session... ",
    );

    if (isTeamsAuthUrl(page.url())) {
      throw new Error("The browser is still on a Microsoft sign-in page. Finish sign-in before saving.");
    }

    await context.storageState({ path: authStatePath });
    console.log(`[meeting-bot] Teams authentication state saved to ${authStatePath}`);
    console.log("[meeting-bot] The saved session can be used for authenticated Teams join and/or Outlook attendee identity.");
    console.log("[meeting-bot] Guest join can keep MEETING_BOT_TEAMS_AUTH_MODE=anonymous while reusing this auth state via MEETING_BOT_IDENTITY_AUTH_STATE.");
  } finally {
    prompt.close();
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
