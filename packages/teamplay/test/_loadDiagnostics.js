// Loaded before every test file (.mocharc.cjs), as the package's Node entry
// (src/index.node.ts) loads diagnostics before the runtime: registries are
// counted from the start and TEAMPLAY_DIAGNOSTICS=... switches them on for the
// whole suite. test/diagnosticsLazy.js covers the main entry without it.
import '../src/diagnostics/index.ts'
