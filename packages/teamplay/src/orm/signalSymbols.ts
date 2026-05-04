export const SEGMENTS = Symbol('path segments targeting the particular node in the data tree')
export const ARRAY_METHOD = Symbol('run array method on the signal')
export const GET = Symbol('get the value of the signal - either observed or raw')
export const GETTERS = Symbol('get the list of this signal\'s getters')
export const DEFAULT_GETTERS = ['path', 'id', 'get', 'peek', 'getId', 'map', 'reduce', 'find', 'getIds', 'getExtra', 'getCollection']
