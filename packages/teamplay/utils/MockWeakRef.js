export class MockWeakRef {
  constructor (value) {
    this.value = value
  }

  deref () {
    return this.value
  }
}

export function destroyMockWeakRef (weakRef) {
  if (!(weakRef instanceof MockWeakRef)) return
  weakRef.value = undefined
}

let ExportedWeakRef

if (typeof WeakRef !== 'undefined') {
  ExportedWeakRef = WeakRef
} else {
  console.warn('WeakRef is not available in this environment. Using a mock implementation: MockWeakRef')
  ExportedWeakRef = MockWeakRef
}

export default ExportedWeakRef
