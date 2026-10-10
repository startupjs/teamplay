// A ShareDB doc that is not created: not loaded yet, missing on the server or
// deleted. Its `data` can be the empty placeholder Doc.js keeps on it for
// racer parity, so a missing doc must never be read through `data`: it is
// never materialized into the data tree nor listed in query results.
export function isMissingShareDoc (doc) {
  return !!doc && doc.type === null
}
