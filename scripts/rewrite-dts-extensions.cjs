const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = process.argv[2]

if (!root) {
  console.error('Usage: node scripts/rewrite-dts-extensions.cjs <dist-dir>')
  process.exit(1)
}

rewriteDirectory(root)

function rewriteDirectory (dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)

    if (stat.isDirectory()) {
      rewriteDirectory(path)
      continue
    }

    if (!path.endsWith('.d.ts')) continue
    rewriteFile(path)
  }
}

function rewriteFile (path) {
  const input = readFileSync(path, 'utf8')
  const output = input.replace(/((?:\.{1,2})\/[^'")]+)\.ts/g, '$1.js')

  if (output !== input) {
    writeFileSync(path, output)
  }
}
