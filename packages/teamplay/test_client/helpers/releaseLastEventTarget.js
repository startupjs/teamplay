import { createRoot } from 'react-dom/client'

// react-dom keeps the fiber of the last DOM event target until the next event
// (`return_targetInst`). In development React 19 records an Error stack on
// every element (`_debugStack`), and that stack keeps the functions which
// created the element alive, together with everything their closures
// reference (a test body's signals). Dispatch a no-op event through a
// container React listens on (createRoot() attaches the listeners; nothing
// is rendered), so a leak check after a fireEvent() sees only what teamplay
// retains.
export function releaseLastEventTarget () {
  const container = document.createElement('div')
  createRoot(container)
  container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}
