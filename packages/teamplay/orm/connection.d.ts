export function connection (...args: any[]): any
export function setConnection (value: any): void
export function getConnection (): any
export function getDefaultFetchOnly (): boolean
export function setDefaultFetchOnly (value?: boolean): boolean
export function fetchOnly<T> (fn: () => T): T
export function setFetchOnly (value?: boolean): boolean
export function publicOnly<T> (fn: () => T): T
export function setPublicOnly (value?: boolean): boolean
