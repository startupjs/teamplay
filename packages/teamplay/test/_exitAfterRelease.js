// Child process for test/nodeTimers.js: subscribes, releases everything, and
// then has nothing left to do. Cleanup timers must not keep it alive.
import { $, sub, unsub, aggregation } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { setSubscriptionGcDelay } from '../src/orm/subscriptionGcDelay.ts'

connect()
setSubscriptionGcDelay(Number(process.env.GC_DELAY || 30000))
const $doc = await sub($.nodeTimerDocs.a)
await $.nodeTimerDocs.b.set({ name: 'b', active: true })
const $query = await sub($.nodeTimerDocs, { active: true })
const $fetched = await sub($.nodeTimerDocs, { name: 'b' }, { mode: 'fetch' })
const $rows = await sub(aggregation(({ active }) => [{ $match: { active } }]), { $collection: 'nodeTimerDocs', active: true })
await $rows[0].name.set('row write')
await unsub($doc)
await unsub($query)
await unsub($fetched)
await unsub($rows)
console.log('released')
