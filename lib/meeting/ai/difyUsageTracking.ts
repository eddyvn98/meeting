/** Lightweight no-op usage hooks for the isolated Meeting test repository. */
export function requestedModelFromInputs(inputs: Record<string, unknown> | undefined): string | null {
  const model = inputs?.model ?? inputs?.model_id;
  return typeof model === "string" ? model : null;
}

export function meetingWorkflowCategory(_apiKey: string): string {
  return "MEETING_WORKFLOW";
}

export function recordDifyBlockingResponse(..._args: unknown[]): void {}

export function createUsageStreamObserver(..._args: unknown[]): {
  onEvent: (_event: unknown) => void;
  finish: (_status?: string) => void;
} {
  return { onEvent() {}, finish() {} };
}
