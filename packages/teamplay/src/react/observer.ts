import type * as React from 'react'
import convertToObserver from './convertToObserver.js'
import wrapIntoSuspense from './wrapIntoSuspense.js'

export interface RuntimeObserverOptions {
  forwardRef?: boolean
  cache?: boolean
  throttle?: number | boolean
  defer?: boolean | number
  suspenseProps?: React.ComponentProps<typeof React.Suspense>
}

type ObserverComponent<TProps extends object> = (props: TProps) => React.ReactNode
type ObserverForwardRefComponent<TProps extends object, TRef> =
  (props: TProps, ref: React.ForwardedRef<TRef>) => React.ReactNode

interface RuntimeObserver {
  <TProps extends object, TRef = unknown>(
    Component: ObserverForwardRefComponent<TProps, TRef>,
    options: RuntimeObserverOptions & { forwardRef: true }
  ): React.NamedExoticComponent<React.PropsWithoutRef<TProps> & React.RefAttributes<TRef>>
  <TProps extends object>(
    Component: ObserverComponent<TProps>,
    options?: RuntimeObserverOptions
  ): React.NamedExoticComponent<TProps>
  __wrapObserverMeta: typeof wrapIntoSuspense
  __makeObserver: typeof convertToObserver
}

const observer = function observer<TProps extends object> (
  Component: ObserverComponent<TProps>,
  options?: RuntimeObserverOptions
): React.NamedExoticComponent<TProps> {
  return wrapIntoSuspense(convertToObserver(Component, options) as never) as unknown as React.NamedExoticComponent<TProps>
} as RuntimeObserver

observer.__wrapObserverMeta = wrapIntoSuspense
observer.__makeObserver = convertToObserver
export default observer
