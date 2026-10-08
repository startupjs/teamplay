// On Node, the cleanup timers TeamPlay schedules (subscription GC delay,
// downgrade grace, deferred local deletions) must not keep a process alive
// once its own work is done: a script or a test runner should exit right
// away instead of waiting for the GC delay.
import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./_exitAfterRelease.js', import.meta.url))

function runScript (env) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(process.execPath, ['--expose-gc', '-C', 'teamplay-ts', script], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const killer = setTimeout(() => child.kill('SIGKILL'), 20000)
    child.on('error', reject)
    child.on('exit', code => {
      clearTimeout(killer)
      resolve({ code, output, ms: Date.now() - startedAt })
    })
  })
}

describe('Node timers', () => {
  it('a script exits once it released its subscriptions, without waiting for the GC delay', async function () {
    this.timeout(30000)
    const { code, output, ms } = await runScript({ GC_DELAY: '15000' })
    assert.equal(code, 0, output)
    assert.match(output, /released/)
    assert.ok(ms < 8000, `the process stayed alive for ${ms} ms after its work`)
  })
})
