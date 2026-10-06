export function meetingBotScheduleLockKey(scheduleId: string): string {
  return `meeting-bot-schedule:${scheduleId}`;
}
