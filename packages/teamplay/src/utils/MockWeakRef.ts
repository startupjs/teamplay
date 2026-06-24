export interface WeakRefLike<TValue extends object = object> {
  deref: () => TValue | undefined
}

export type WeakRefLikeConstructor = new <TValue extends object>(
  value: TValue
) => WeakRefLike<TValue>

export class MockWeakRef<TValue extends object = object> implements WeakRefLike<TValue> {
  value: TValue | undefined

  constructor (value: TValue) {
    this.value = value
  }

  deref (): TValue | undefined {
    return this.value
  }
}

export function destroyMockWeakRef (weakRef: unknown): void {
  if (!(weakRef instanceof MockWeakRef)) return
  weakRef.value = undefined
}

let ExportedWeakRef: WeakRefLikeConstructor

if (typeof WeakRef !== 'undefined') {
  ExportedWeakRef = WeakRef as WeakRefLikeConstructor
} else {
  console.warn('WeakRef is not available in this environment. Using a mock implementation: MockWeakRef')
  ExportedWeakRef = MockWeakRef
}

export default ExportedWeakRef
