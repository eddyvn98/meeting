import { createGraphCalendarClient } from "./meeting-bot-calendar.mjs";

async function main() {
  const client = createGraphCalendarClient();
  const snapshot = await client.fetchSnapshot();

  const teamsEvents = snapshot.events.filter((event) => typeof event.meetingUrl === "string");
  const eligibleEvents = teamsEvents.filter((event) =>
    !event.cancelled &&
    !event.declined &&
    event.invited &&
    event.organizerAllowed &&
    typeof event.ownerEmail === "string"
  );
  const blockedEvents = teamsEvents.filter((event) => !event.organizerAllowed);
  const notInvitedEvents = teamsEvents.filter((event) => !event.invited);

  console.log("[meeting-bot] Microsoft Graph bot-mailbox access is working.");
  console.log(`Bot mailbox: ${snapshot.botEmail}`);
  console.log(`Graph user: ${snapshot.userId}`);
  console.log(`Window: ${snapshot.windowStart} -> ${snapshot.windowEnd}`);
  console.log(`Graph pages: ${snapshot.pages}`);
  console.log(`Calendar events: ${snapshot.rawEventCount}`);
  console.log(`Teams events: ${teamsEvents.length}`);
  console.log(`Eligible invited meetings: ${eligibleEvents.length}`);
  console.log(`Blocked organizer events: ${blockedEvents.length}`);
  console.log(`Events where bot is not an attendee: ${notInvitedEvents.length}`);

  for (const event of eligibleEvents.slice(0, 10)) {
    console.log(`- ${event.scheduledAt} | ${event.ownerEmail} | ${event.title}`);
  }
  if (eligibleEvents.length > 10) {
    console.log(`... and ${eligibleEvents.length - 10} more`);
  }
}

main().catch((error) => {
  console.error("[meeting-bot] Graph check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
