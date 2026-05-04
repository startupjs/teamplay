import type Signal from './Signal.ts'

export const LOCAL: string

export default function $ (
  $root: Signal,
  value?: unknown,
  id?: string
): Signal
