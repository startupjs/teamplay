// Node entry of 'teamplay' (package.json exports, "node" condition).
//
// Loads the full diagnostics implementation before the runtime, so that
// TEAMPLAY_DIAGNOSTICS=1 (or =trace,stacks) works without an extra import and
// its counters cover the whole process, and `diagnostics` from 'teamplay' is
// fully functional on the server. Browser and React Native bundles resolve
// index.ts, which ships only the diagnostics switch (diagnostics/hooks.ts).
import './diagnostics/index.ts'
export * from './index.ts'
export { default } from './index.ts'
