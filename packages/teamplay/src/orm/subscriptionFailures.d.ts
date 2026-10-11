export function getSubscriptionFailureKey (kind: string, hash: string): string
export function getSubscriptionFailure (key: string | undefined): unknown
export function setSubscriptionFailure (key: string, error: unknown): void
export function clearSubscriptionFailure (key: string): void
export function getSubscriptionFailureCount (): number
export function reportSubscriptionError (
  err: unknown,
  details: { path: string, stopped: boolean, owned: boolean }
): void
