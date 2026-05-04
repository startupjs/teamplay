let isServer = checkIsServer()

interface ProcessLike {
  __mockBrowser?: boolean
  versions?: { node?: string }
}

interface DenoLike {
  version?: { deno?: string }
}

function checkIsServer (): boolean | undefined {
  const processLike = (globalThis as { process?: ProcessLike }).process
  const denoLike = (globalThis as { Deno?: DenoLike }).Deno
  if (typeof processLike === 'object' && processLike.__mockBrowser) {
    return false
  } else if (denoLike?.version?.deno) {
    return true
  } else if (typeof processLike === 'object' && processLike.versions?.node) {
    return true
  }
}

export function setIsServer (value: boolean | undefined): void {
  isServer = value
}

export default isServer
