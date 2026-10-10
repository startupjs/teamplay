// process.env.NODE_ENV is not 'production' (true without process.env)
export default function isDevMode (): boolean {
  const processLike = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process
  if (!processLike?.env) return true
  return processLike.env.NODE_ENV !== 'production'
}
