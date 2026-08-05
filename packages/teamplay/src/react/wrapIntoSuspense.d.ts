import type * as React from 'react'
import type { ConvertedObserver } from './convertToObserver.js'

export declare function SuspenseGroup (props: {
  children?: React.ReactNode
  fallback?: React.ReactNode
}): React.ReactElement

export declare function useSuspenseGroupScheduleUpdate (): ((promise: PromiseLike<unknown>) => void) | undefined

export interface WrapIntoSuspenseOptions<TProps extends object = Record<string, unknown>, TRef = unknown>
  extends ConvertedObserver<TProps, TRef> {}

export default function wrapIntoSuspense<TProps extends object, TRef = unknown> (
  options?: WrapIntoSuspenseOptions<TProps, TRef>
): React.NamedExoticComponent<TProps>
