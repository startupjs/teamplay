import type * as React from 'react'
import type { ConvertedObserver } from './convertToObserver.js'

export interface WrapIntoSuspenseOptions<TProps extends object = Record<string, unknown>, TRef = unknown>
  extends ConvertedObserver<TProps, TRef> {}

export default function wrapIntoSuspense<TProps extends object, TRef = unknown> (
  options?: WrapIntoSuspenseOptions<TProps, TRef>
): React.NamedExoticComponent<TProps>
