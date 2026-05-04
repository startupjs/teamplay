export const isAccessControlSymbol: unique symbol = Symbol('is access control object')

export const OPERATIONS = [
  'create',
  'read',
  'update',
  'delete'
] as const

export type AccessOperation = typeof OPERATIONS[number]

export type AccessDecision = boolean | Promise<boolean>

/** Default TeamPlay session shape available in access-control validators. */
export interface DefaultAccessSession {
  userId?: string
}

/** Shared fields passed to every access-control validator. */
export interface AccessBaseContext<TSession = DefaultAccessSession> {
  /** Operation being checked. */
  type: AccessOperation
  /** ShareDB collection name. */
  collection: string
  /** ShareDB document id. */
  docId: string
  /** Connect session object attached to the ShareDB request. */
  session: TSession
}

/** Context passed to the `create` access rule. */
export interface AccessCreateContext<TDoc = unknown, TSession = DefaultAccessSession>
  extends AccessBaseContext<TSession> {
  type: 'create'
  /** Document data being created. */
  newDoc: TDoc
}

/** Context passed to the `read` access rule. */
export interface AccessReadContext<TDoc = unknown, TSession = DefaultAccessSession>
  extends AccessBaseContext<TSession> {
  type: 'read'
  /** Existing document data being read. */
  doc: TDoc
}

/** Context passed to the `update` access rule. */
export interface AccessUpdateContext<TDoc = unknown, TSession = DefaultAccessSession>
  extends AccessBaseContext<TSession> {
  type: 'update'
  /** Document data before the operation. */
  doc: TDoc
  /** Document data after the operation. */
  newDoc: TDoc
  /** Raw ShareDB operations being applied. */
  ops: unknown[]
}

/** Context passed to the `delete` access rule. */
export interface AccessDeleteContext<TDoc = unknown, TSession = DefaultAccessSession>
  extends AccessBaseContext<TSession> {
  type: 'delete'
  /** Existing document data being deleted. */
  doc: TDoc
}

/**
 * Function access rule.
 *
 * @param context Operation-specific context. For example, `create` receives
 * `{ type: 'create', newDoc, collection, docId, session }`, while `update`
 * receives `{ type: 'update', doc, newDoc, ops, collection, docId, session }`.
 * @returns `true` to allow the operation, `false` to deny it.
 */
export type AccessValidator<TContext> = (context: TContext) => AccessDecision

/** Object access rule shape supported by ShareDB access validators. */
export interface AccessValidatorObject<TContext> {
  /**
   * Function access rule.
   * @param context Operation-specific access context.
   * @returns `true` to allow the operation, `false` to deny it.
   */
  fn: AccessValidator<TContext>
}

/**
 * Access rule for one operation.
 *
 * Use `true` to always allow, `false` or omission to deny, a function to decide
 * from the operation context, or `{ fn }` when integrating with ShareDB access
 * validator objects. `TCustomRule` can be used for custom ShareDB validators.
 */
export type AccessRule<TContext, TCustomRule = never> =
  | boolean
  | AccessValidator<TContext>
  | AccessValidatorObject<TContext>
  | TCustomRule

/** Access rules for a collection document. */
export interface AccessControlRules<
  TDoc = unknown,
  TSession = DefaultAccessSession,
  TCustomRule = never
> {
  /**
   * Controls document creation.
   *
   * Use `true` to allow all creates, `false` or omission to deny creates, or a
   * function to decide per request. When this rule is a function, it receives
   * `{ type: 'create', newDoc, collection, docId, session }`.
   */
  create?: AccessRule<AccessCreateContext<TDoc, TSession>, TCustomRule>

  /**
   * Controls document reads.
   *
   * Use `true` to allow all reads, `false` or omission to deny reads, or a
   * function to decide per request. When this rule is a function, it receives
   * `{ type: 'read', doc, collection, docId, session }`.
   */
  read?: AccessRule<AccessReadContext<TDoc, TSession>, TCustomRule>

  /**
   * Controls document updates.
   *
   * Use `true` to allow all updates, `false` or omission to deny updates, or a
   * function to decide per request. When this rule is a function, it receives
   * `{ type: 'update', doc, newDoc, ops, collection, docId, session }`.
   */
  update?: AccessRule<AccessUpdateContext<TDoc, TSession>, TCustomRule>

  /**
   * Controls document deletion.
   *
   * Use `true` to allow all deletes, `false` or omission to deny deletes, or a
   * function to decide per request. When this rule is a function, it receives
   * `{ type: 'delete', doc, collection, docId, session }`.
   */
  delete?: AccessRule<AccessDeleteContext<TDoc, TSession>, TCustomRule>
}

export type AccessControl<
  TDoc = unknown,
  TSession = DefaultAccessSession,
  TCustomRule = never
> = AccessControlRules<TDoc, TSession, TCustomRule> & {
  readonly [isAccessControlSymbol]: true
}

type MutableAccessControl<
  TDoc = unknown,
  TSession = DefaultAccessSession,
  TCustomRule = never
> = AccessControlRules<TDoc, TSession, TCustomRule> & {
  [isAccessControlSymbol]?: true
}

/** Check whether a value was created with `accessControl()`. */
export function isAccessControl (something: unknown): something is AccessControl {
  return Boolean((something as Partial<AccessControl> | undefined)?.[isAccessControlSymbol])
}

/**
 * Mark collection access rules for backend registration.
 *
 * The object can contain `create`, `read`, `update`, and `delete` keys:
 * `create` controls new document creation, `read` controls reading existing
 * documents, `update` controls writes to existing documents, and `delete`
 * controls document deletion.
 *
 * Each rule can be `true`, `false`, a validator function, or `{ fn }`. Omitted
 * rules deny the operation. Validator functions may return a boolean or a
 * promise resolving to a boolean.
 *
 * Function rules receive operation-specific context:
 * `create` receives `{ type: 'create', newDoc, collection, docId, session }`;
 * `read` receives `{ type: 'read', doc, collection, docId, session }`;
 * `update` receives `{ type: 'update', doc, newDoc, ops, collection, docId, session }`;
 * `delete` receives `{ type: 'delete', doc, collection, docId, session }`.
 *
 * @typeParam TDoc Document shape for the collection this access object belongs to.
 * @typeParam TSession Session shape attached to ShareDB requests.
 * @typeParam TCustomRule Extra rule value accepted by a custom ShareDB access validator.
 * @param props Access rules keyed by `create`, `read`, `update`, and `delete`.
 */
export function accessControl<
  TDoc = unknown,
  TSession = DefaultAccessSession,
  TCustomRule = never
> (
  props: AccessControlRules<TDoc, TSession, TCustomRule>
): AccessControl<TDoc, TSession, TCustomRule> {
  if (!props || typeof props !== 'object') throw Error(ERRORS.mustBeObject(props))
  for (const key in props) {
    if (!(OPERATIONS as readonly string[]).includes(key)) throw Error(ERRORS.unknownOperation(key))
  }
  const access = props as MutableAccessControl<TDoc, TSession, TCustomRule>
  access[isAccessControlSymbol] ??= true
  return access as AccessControl<TDoc, TSession, TCustomRule>
}

const ERRORS = {
  mustBeObject: (props: unknown) => `
    accessControl: must be an object.
    Got: ${JSON.stringify(props)}
  `,
  unknownOperation: (op: string) => `
    accessControl: unknown operation is specified.
    Got: '${op}'
    Available: ${JSON.stringify(OPERATIONS)}
  `
}
