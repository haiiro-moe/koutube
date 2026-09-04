declare global {
  type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
  type ScheduledEvent = unknown;
}
export {};
