// Compiled with the React Compiler (see reactCompilerTransform.cjs), the way an
// app with the compiler enabled compiles its own code. The compiler caches a
// value while its inputs keep the same identity, and a signal keeps its
// identity when its data changes: `$doc.count` is the same object before and
// after `$doc.count.set(2)`.
import { useEffect } from 'react'
import { $, observer } from '../../src/index.ts'

// (a) A custom hook is compiled (a `use` name that calls a hook):
//   if ($[1] !== $doc.count) { t0 = $doc.count.get() ?? 0 } else { t0 = $[2] }
export function useCount ($doc) {
  const count = $doc.count.get() ?? 0
  useEffect(() => {}, [])
  return count
}

export function useCountNoMemo ($doc) {
  'use no memo'
  const count = $doc.count.get() ?? 0
  useEffect(() => {}, [])
  return count
}

// The compiler compiles only the arguments of memo() and forwardRef(), so it
// leaves this inline function alone, but compiles the hook it calls.
export const HookAndDirectRead = observer(function HookAndDirectRead ({ $doc }) {
  const fromHook = useCount($doc)
  return <span>{fromHook}/{$doc.count.get()}</span>
})

export const NoMemoHookAndDirectRead = observer(function NoMemoHookAndDirectRead ({ $doc }) {
  const fromHook = useCountNoMemo($doc)
  return <span>{fromHook}/{$doc.count.get()}</span>
})

// (b) A component declared on its own and wrapped afterwards is compiled.
export function DocCountBase ({ $doc }) {
  return <span>{$doc.count.get()}</span>
}
export const DocCount = observer(DocCountBase)

export const InlineDocCount = observer(function InlineDocCount ({ $doc }) {
  return <span>{$doc.count.get()}</span>
})

function DocCountNoMemoBase ({ $doc }) {
  'use no memo'
  return <span>{$doc.count.get()}</span>
}
export const DocCountNoMemo = observer(DocCountNoMemoBase)

// The imported root signal is a module constant for the compiler: this JSX
// is created once and never again.
function RootReadBase ({ path }) {
  return <span>{$.session[path].count.get()}</span>
}
export const RootRead = observer(RootReadBase)

// (c) Derived values, a local signal and a computed signal.
function DocTotalBase ({ $doc }) {
  const total = $doc.items.get().reduce((sum, n) => sum + n, 0)
  return <span>{total * 2}</span>
}
export const DocTotal = observer(DocTotalBase)

function LocalCounterBase () {
  const $count = $(0)
  return <button onClick={() => $count.set($count.get() + 1)}>{$count.get()}</button>
}
export const LocalCounter = observer(LocalCounterBase)

function ComputedDoubleBase ({ $doc }) {
  const $double = $(() => $doc.count.get() * 2)
  return <span>{$double.get()}</span>
}
export const ComputedDouble = observer(ComputedDoubleBase)

// (d) Not wrapped in observer(): never reactive. A re-render from its parent
// would still show the new value, but the compiler also caches the parent's
// `<PlainDocCount $doc={$doc} />` element, so that re-render does not happen.
export function PlainDocCount ({ $doc }) {
  return <span>{$doc.count.get()}</span>
}
