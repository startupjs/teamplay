import sharedbAccess, { registerOrmRules } from '@teamplay/sharedb-access'
import { getAccessControlOptions, isAccessControl } from '@teamplay/utils/accessControl'

export default function accessControl (
  backend,
  { models = {}, dontUseOldDocs = true, forceOnly = false, serverOnlyCollections = [], ...options } = {}
) {
  const shareDbAccess = sharedbAccess(backend, { dontUseOldDocs, ...options })

  for (const collectionName of serverOnlyCollections) {
    backend.protectAccessCollection(collectionName)
  }

  for (const modelPattern in models) {
    const { access, factory } = models[modelPattern]

    if (factory) {
      // TODO: implement checking access from factory
      throw Error('accessControl factory model: NOT IMPLEMENTED')
    } else if (access) {
      const collectionName = modelPattern
      if (/\./.test(collectionName)) throw Error(ERRORS.onlyTopLevelCollections(modelPattern))
      if (!isAccessControl(access)) {
        if (forceOnly) continue
        throw Error(ERRORS.improperAccessControlProps(collectionName, access))
      }
      const { force } = getAccessControlOptions(access)
      if (forceOnly && !force) continue
      if (force) backend.protectAccessCollection(collectionName)
      registerOrmRules(backend, collectionName, access)
    }
  }

  console.log('✓ Security: Access Control for DB collections on backend is enabled')
  return shareDbAccess
}

export function hasForcedAccessControls (models = {}) {
  for (const modelPattern in models) {
    const { access } = models[modelPattern]
    if (isAccessControl(access) && getAccessControlOptions(access).force) return true
  }
  return false
}

const ERRORS = {
  onlyTopLevelCollections: (modelPattern) => `
    accessControl: you can only define 'access' for access control rules in the top-level collection models
      (i.e. 'model/items.js')
      Found 'access' in '${modelPattern}'.
      Move it to the top-level collection model: 'models/${modelPattern.split('.')[0]}.js'
  `,
  improperAccessControlProps: (collectionName, props) => `
    accessControl: received incorrect 'access' object for accessControl.
    Possibly not wrapped into an \`accessControl()\` call.

    Make sure you wrap your 'access' object into an \`accessControl({})\` call:
    Example:
      import { accessControl } from 'startupjs'
      export const access = accessControl({
        create: () => true,
        ...
      })

    Collection name: '${collectionName}'
    Got:
      ${JSON.stringify(props)}
  `
}
