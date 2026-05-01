export const COLLECTION_NAME: unique symbol
export const PARAMS: unique symbol
export const HASH: unique symbol
export const IS_QUERY: unique symbol
export const QUERIES: '$queries'
export const querySubscriptions: any
export function getQuerySignal (...args: any[]): any
export function hashQuery (collectionName: string, params: any): string
export function parseQueryHash (hash: string): { collectionName?: string, params?: any }
