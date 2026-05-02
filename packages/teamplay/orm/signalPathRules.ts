import type { PathSegment } from './types/path.ts'

export const ROOT_DOLLAR_ALIASES: Readonly<Record<string, string>> = {
  session: '_session',
  page: '_page',
  render: '$render',
  system: '$system'
}

const REGEX_POSITIVE_INTEGER = /^(?:0|[1-9]\d*)$/
const REGEX_LEADING_DOLLAR = /^\$/

export function transformRootDollarAlias (
  segments: readonly PathSegment[],
  key: string,
  aliases: Readonly<Record<string, string>> = ROOT_DOLLAR_ALIASES
): string {
  if (REGEX_LEADING_DOLLAR.test(key)) key = key.slice(1)
  if (segments.length === 0) return aliases[key] || key
  return key
}

export function maybeTransformToArrayIndex (key: string): string | number {
  if (REGEX_POSITIVE_INTEGER.test(key)) return +key
  return key
}

export function normalizeSignalPropertyKey (
  segments: readonly PathSegment[],
  key: string
): string | number {
  return maybeTransformToArrayIndex(transformRootDollarAlias(segments, key))
}
