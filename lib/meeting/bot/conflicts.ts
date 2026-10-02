import { prisma } from "@/lib/prisma";

const NON_TERMINAL = [
  "REQUESTED",
  "CLAIMED",
  "JOINING",
  "LOBBY",
  "JOINED",
  "CAPTURING",
  "STOP_REQUESTED",
] as const;

export async function findConflictingBotSession({
  meetingUrl,
  scheduledAt,
  excludeId,
  windowMs = 10 * 60_000,
}: {
  meetingUrl: string;
  scheduledAt: Date;
  excludeId?: string;
  windowMs?: number;
}) {
  const from = new Date(scheduledAt.getTime() - windowMs);
  const to = new Date(scheduledAt.getTime() + windowMs);
  return prisma.meetingBotSession.findFirst({
    where: {
      meetingUrl,
      status: { in: [...NON_TERMINAL] },
      scheduledAt: { gte: from, lte: to },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { requestedAt: "asc" },
  });
}
