import * as React from 'react'
import { $, observer, type Signal } from 'teamplay'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false

type Expect<T extends true> = T

interface EventDoc {
  name: string
  createdAt: number
}

interface CreateModalProps {
  $show: Signal<boolean>
  $new: Signal<EventDoc>
  title: string
  optionalCount?: number
}

const CreateModal = observer(function CreateModal ({
  $show,
  $new,
  title,
  optionalCount
}: CreateModalProps) {
  const show: boolean = $show.get()
  const name: string = $new.name.get()

  $show.set(true)
  $new.assign({ name: title, createdAt: Date.now() })

  void show
  void name
  void optionalCount

  return React.createElement('div')
})

type CreateModalPropsFromObserver = React.ComponentProps<typeof CreateModal>
type ObserverKeepsComponentProps = Expect<Equal<CreateModalPropsFromObserver, CreateModalProps>>

React.createElement(CreateModal, {
  $show: $<boolean>(),
  $new: $<EventDoc>(),
  title: 'Create event'
})

// @ts-expect-error observer result should require props from the wrapped component
const missingRequiredProp: CreateModalPropsFromObserver = {
  $show: $<boolean>(),
  $new: $<EventDoc>()
}

const wrongSignalProp: CreateModalPropsFromObserver = {
  // @ts-expect-error observer result should preserve signal prop types
  $show: $<string>(),
  $new: $<EventDoc>(),
  title: 'Create event'
}

const Input = observer(function Input (
  { label }: { label: string },
  ref: React.ForwardedRef<HTMLInputElement>
) {
  return React.createElement('input', { ref, 'aria-label': label })
}, { forwardRef: true })

React.createElement(Input, {
  label: 'Name',
  ref: React.createRef<HTMLInputElement>()
})

React.createElement(Input, {
  label: 'Name',
  // @ts-expect-error forwardRef observer result should preserve ref type
  ref: React.createRef<HTMLTextAreaElement>()
})

void missingRequiredProp
void wrongSignalProp
