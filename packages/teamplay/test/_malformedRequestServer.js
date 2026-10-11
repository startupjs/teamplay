// Run by accessControlRequests.js in a child process with a small heap: a
// client claims a query resubscribe with a billion results; the server must
// refuse it at once and go on serving.
import {
  connectClient,
  create,
  createBackendWithRules,
  fetch,
  sendRaw,
  silenceShareDbLogger
} from './_accessControl.js'

silenceShareDbLogger()
const backend = createBackendWithRules()
const server = backend.connect()
await create(server.get('contacts', 'c1'), { ownerId: 'alice', name: 'Contact' })

const bob = connectClient(backend, { userId: 'bob' })
const reply = await sendRaw(bob, { a: 'qs', id: 1, c: 'contacts', q: {}, r: { length: 1e9 } }, data => data.id === 1)
console.log('refused', reply.error?.code)

const alice = connectClient(backend, { userId: 'alice' })
const doc = alice.get('contacts', 'c1')
await fetch(doc)
if (doc.data?.name === 'Contact') console.log('still serving')
process.exit(0)
