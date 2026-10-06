export function liveRoomNotificationDedupeKey(
  meetingId: string,
  recipientEmail: string,
): string {
  return `live-room:${meetingId}:${recipientEmail.trim().toLowerCase()}`;
}
