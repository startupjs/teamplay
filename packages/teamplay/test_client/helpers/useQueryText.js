import { useState } from 'react'

// a hook imported from another module (as useAsyncSub() is)
export function useQueryText (query) {
  const [prefix] = useState('q')
  return prefix + ':' + query.$aggregate[0].$match.tenantId + '|' + query.$aggregate[2].$match.name.$regex
}
