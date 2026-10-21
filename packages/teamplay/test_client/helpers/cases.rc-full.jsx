// React Compiler fixtures, compiled by reactCompilerTransform.cjs with the
// `reactCompiler` option of babel-plugin-teamplay that the file name picks:
// cases.rc-full.jsx ('full') and cases.rc-optout.jsx ('optOut') have the same
// code from the first import on (63_react-compiler-modes.js checks it).
import { useCallback, useEffect } from 'react'
import { $, observer, useSignal } from '../../src/index.ts'

// (a) a custom hook reading a signal, called from an inline observer() function
export function useCount ($doc) {
  const count = $doc.count.get() ?? 0
  useEffect(() => {}, [])
  return count
}
export const HookAndDirectRead = observer(function HookAndDirectRead ({ $doc }) {
  const fromHook = useCount($doc)
  return <span>{fromHook}/{$doc.count.get()}</span>
})

// (b) a component declared on its own, wrapped afterwards
export function DocCountBase ({ $doc }) {
  return <span>{$doc.count.get()}</span>
}
export const DocCount = observer(DocCountBase)

// a read from the imported root signal
function RootReadBase ({ path }) {
  return <span>{$.session[path].count.get()}</span>
}
export const RootRead = observer(RootReadBase)

// (c) a derived value, a local signal, a computed signal
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

// (e) a memoized callback and an effect on it: the callback keeps its
// identity when the signal changes, so the effect does not run again
export const saveEffects = { runs: 0 }
function SaveButtonBase ({ $doc, onSave }) {
  const save = useCallback(() => onSave($doc.name.get()), [onSave, $doc])
  useEffect(() => { saveEffects.runs++ }, [save])
  return <button onClick={save}>{$doc.name.get()}</button>
}
export const SaveButton = observer(SaveButtonBase)

// (f) an early return and a list
function ListOrNothingBase ({ $doc, show }) {
  if (!show) return null
  const items = $doc.items.get()
  return <ul>{items.map(n => <li key={n}>{n}</li>)}</ul>
}
export const ListOrNothing = observer(ListOrNothingBase)

// (g) an object changed in place, passed to a child that is not an observer
function CityCard ({ profile }) {
  return <i>{profile.city}</i>
}
function ProfileBase ({ $doc }) {
  const profile = $doc.profile.get()
  const label = profile.city.toUpperCase()
  return <div><b>{label}</b><CityCard profile={profile} /></div>
}
export const Profile = observer(ProfileBase)

// (h) no signals: compiled and memoized as usual
export function Pure ({ n }) {
  return <b>{n * 2}</b>
}

// (d) control: not wrapped in observer()
export function PlainDocCount ({ $doc }) {
  return <span>{$doc.count.get()}</span>
}

// a render that suspends after reading a signal
export const suspense = { promise: undefined, resolve: undefined }
function useSuspendIf (wait) {
  if (!wait) return
  suspense.promise ??= new Promise(resolve => {
    suspense.resolve = () => {
      suspense.promise = undefined
      resolve()
    }
  })
  throw suspense.promise
}
function SuspendingBase ({ $doc }) {
  const info = { n: $doc.count.get() }
  useSuspendIf($doc.wait.get())
  return <span>n={info.n}</span>
}
export const Suspending = observer(SuspendingBase)

// scopes in a block, in a loop, and a style object
function ArticleBase ({ $doc, show }) {
  let content = null
  if (show) {
    const title = { text: $doc.title.get() }
    content = <div><h1>{title.text}</h1><p>{$doc.body.get()}</p></div>
  }
  return <section>{content}</section>
}
export const Article = observer(ArticleBase)
function LabeledRowsBase ({ $doc, items }) {
  const rows = []
  for (const item of items) rows.push(<li key={item}>{item}:{$doc.label.get()}</li>)
  return <ul>{rows}</ul>
}
export const LabeledRows = observer(LabeledRowsBase)
function ColoredBase ({ $doc }) {
  const style = { color: $doc.color.get() }
  return <main><b style={style}>{$doc.text.get()}</b></main>
}
export const Colored = observer(ColoredBase)

// useSignal(), the hook form of $()
function ExplicitHookBase ({ $doc }) {
  const $clicks = useSignal(0)
  const $tens = useSignal(() => $doc.count.get() * 10)
  return <button onClick={() => $clicks.set($clicks.get() + 1)}>{$clicks.get()}:{$tens.get()}</button>
}
export const ExplicitHook = observer(ExplicitHookBase)
