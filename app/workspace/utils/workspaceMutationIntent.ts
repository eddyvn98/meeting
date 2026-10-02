let pendingOperation: string | null = null;

/** Marks the next debounced board save with its user-visible operation type. */
export function markWorkspaceMutation(operation: string): void {
  pendingOperation = operation;
}

/** Consumes the operation once the save payload has captured it. */
export function consumeWorkspaceMutation(): string | null {
  const operation = pendingOperation;
  pendingOperation = null;
  return operation;
}
