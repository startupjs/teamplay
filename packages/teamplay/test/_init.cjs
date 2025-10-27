// This is not used atm. Might be needed in future for simulating some client tests on server
init(false)

function init (enabled = true) {
  if (!enabled) return
  mockBrowser()
}

function mockBrowser () {
  // simulate that we are on the client
  if (typeof window === 'undefined') global.window = {}
  process.title = 'browser'
  process.nextTick = process.nextTick || (typeof setImmediate !== 'undefined' && setImmediate) || (fn => setTimeout(fn, 0))
}
