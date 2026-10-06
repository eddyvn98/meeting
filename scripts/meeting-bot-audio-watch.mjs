export async function maybeRecoverSilentAudio({
  recorderRuntime,
  reconnectTeams,
  recorder,
  teamsRuntime,
  session,
  heartbeat,
  sink,
  storageState,
  participantCount,
  lastRecoveryAt,
  audioInitialWarnMs,
  audioSilenceWarnMs,
}) {
  const health = await recorderRuntime.audioHealth(recorder);
  if (!health) return { teamsRuntime, lastRecoveryAt };

  if (health.trackReadyState === "ended" || health.trackEnabled === false) {
    const error = new Error("The recorder audio source ended while the meeting was active.");
    error.code = "RECORDER_SOURCE_ENDED";
    throw error;
  }

  const now = Date.now();
  const noInitialSignal =
    health.lastSignalAt === null &&
    now - health.startedAt >= audioInitialWarnMs;
  const staleSignal =
    health.lastSignalAt !== null &&
    now - health.lastSignalAt >= audioSilenceWarnMs;

  if (!noInitialSignal && !staleSignal) return { teamsRuntime, lastRecoveryAt };
  if (lastRecoveryAt && now - lastRecoveryAt < 10 * 60_000) {
    return { teamsRuntime, lastRecoveryAt };
  }

  console.warn(
    `[meeting-bot] session ${session.id} audio is silent; rms=${health.rms.toFixed(6)} peak=${health.peakRms.toFixed(6)}.`,
  );

  if (typeof participantCount !== "number" || participantCount <= 1) {
    // No recovery was attempted. Keep the previous timestamp so a participant
    // appearing on the next poll can trigger recovery immediately instead of
    // being suppressed by the 10-minute cooldown.
    return { teamsRuntime, lastRecoveryAt };
  }

  await recorderRuntime.pause(recorder);
  const recovered = await reconnectTeams(
    teamsRuntime,
    session,
    heartbeat,
    sink.sinkName,
    storageState,
  );
  if (!recovered) return { teamsRuntime: null, lastRecoveryAt: now };
  await recorderRuntime.resume(recorder);

  return { teamsRuntime: recovered, lastRecoveryAt: now };
}
