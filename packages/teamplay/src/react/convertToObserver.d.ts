import type * as React from 'react'

export interface ConvertToObserverOptions {
  forwardRef?: boolean
  cache?: boolean
  throttle?: number | boolean
  defer?: boolean | number
  suspenseProps?: React.ComponentProps<typeof React.Suspense>
}

export interface ConvertedObserver<TProps extends object = Record<string, unknown>, TRef = unknown> {
  Component:
    | ((props: TProps) => React.ReactNode)
    | ((props: TProps, ref: React.ForwardedRef<TRef>) => React.ReactNode)
  forwardRef?: boolean
  defer?: boolean | number
  suspenseProps?: React.ComponentProps<typeof React.Suspense>
  [option: string]: unknown
}

export default function convertToObserver<TProps extends object, TRef = unknown> (
  Component:
    | ((props: TProps) => React.ReactNode)
    | ((props: TProps, ref: React.ForwardedRef<TRef>) => React.ReactNode),
  options?: ConvertToObserverOptions
): ConvertedObserver<TProps, TRef>
