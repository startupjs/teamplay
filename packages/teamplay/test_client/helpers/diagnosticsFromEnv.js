// jest setupFiles: with TEAMPLAY_DIAGNOSTICS set, load diagnostics before each
// test file (as the Node entry or an app's first `import 'teamplay/diagnostics'`
// would), so the whole suite runs instrumented. Without it only the test files
// that import the subpath load it; the others run against the bare main entry,
// which checks that no hook site calls the empty hook table.
if (process.env.TEAMPLAY_DIAGNOSTICS) await import('../../src/diagnostics/index.ts')
