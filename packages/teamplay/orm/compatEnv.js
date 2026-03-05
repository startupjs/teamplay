export function isCompatEnv () {
  return globalThis?.teamplayCompatibilityMode ??
    (typeof process !== 'undefined' && process?.env?.TEAMPLAY_COMPAT === '1')
}
