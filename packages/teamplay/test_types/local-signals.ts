import { $, getSignal, signal, useSignal, type TypedSignal } from '../src/index.ts'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false
type Expect<T extends true> = T

const $count = signal(0)
const $double = signal(() => $count.get() * 2)
const $dollarCount = $(0)
// a hook, so in a hook
function useLocalSignals () {
  return { $hookCount: useSignal(0), $hookName: useSignal(() => 'name') }
}
type HookSignals = ReturnType<typeof useLocalSignals>

export type LocalSignalTests = [
  Expect<Equal<typeof $count, TypedSignal<number>>>,
  Expect<Equal<typeof $double, TypedSignal<number>>>,
  Expect<Equal<HookSignals['$hookCount'], TypedSignal<number>>>,
  Expect<Equal<HookSignals['$hookName'], TypedSignal<string>>>,
  // the same types as $()
  Expect<Equal<typeof $count, typeof $dollarCount>>
]

// the deprecated getSignal() form
signal($, ['users'])
getSignal(undefined, [])
