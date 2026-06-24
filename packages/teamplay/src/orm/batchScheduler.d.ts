export function beginBatch (): void
export function endBatch (): void
export function inBatch (): boolean
export function runInBatch<TResult> (fn: () => TResult): TResult
export function scheduleReaction (reactionFn: () => unknown): void
export function flushReactions (): void
export function __resetBatchSchedulerForTests (): void
