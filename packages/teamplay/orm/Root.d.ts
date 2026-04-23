import type { AnySignal } from './Signal.js'

export const ROOT: unique symbol
export const ROOT_ID: unique symbol
export const ROOT_FUNCTION: unique symbol
export const GLOBAL_ROOT_ID: string

export function getRootSignal (options?: Record<string, any>): AnySignal
export function getRoot ($signal: unknown): AnySignal | undefined
