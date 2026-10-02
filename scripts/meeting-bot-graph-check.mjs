import { createGraphCalendarClient } from "./meeting-bot-calendar.mjs";

async function main() {
  const client = createGraphCalendarClient();
  const snapshot = await client.fetchSnapshot();

  const teamsEvents = snapshot.events.filter((event) => typeof event.meetingUrl === "string");
  const activeTeamsEvents = teamsEvents.filter((event) => !event.cancelled && !event.declined);

  console.log("[meeting-bot] Microsoft Graph calendar access is working.");
  console.log(`Mailbox: ${snapshot.userId}`);
  console.log(`Meeting owner: ${snapshot.ownerEmail}`);
  console.log(`Window: ${snapshot.windowStart} -> ${snapshot.windowEnd}`);
  console.log(`Graph pages: ${snapshot.pages}`);
  console.log(`Calendar events: ${snapshot.rawEventCount}`);
  console.log(`Teams events: ${teamsEvents.length}`);
  console.log(`Eligible auto-join events: ${activeTeamsEvents.length}`);

  for (const event of activeTeamsEvents.slice(0, 10)) {
    console.log(`- ${event.scheduledAt} | ${event.title}`);
  }
  if (activeTeamsEvents.length > 10) {
    console.log(`... and ${activeTeamsEvents.length - 10} more`);
  }
}

main().catch((error) => {
  console.error("[meeting-bot] Graph check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
