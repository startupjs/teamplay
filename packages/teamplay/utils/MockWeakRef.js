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

export default (typeof WeakRef !== 'undefined' ? WeakRef : MockWeakRef)
