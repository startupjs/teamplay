// Cleanup timers (subscription GC delay, grace periods, deferred deletions)
// must not keep a Node process alive: when nothing else is pending the process
// exits and the cleanup is moot. Browser timers are numbers without unref(), so
// this is a no-op there. Never use it for timers that run user work.
export default function unrefTimer<TTimer> (timer: TTimer): TTimer {
  const handle = timer as { unref?: () => unknown } | undefined
  if (typeof handle?.unref === 'function') handle.unref()
  return timer
}
