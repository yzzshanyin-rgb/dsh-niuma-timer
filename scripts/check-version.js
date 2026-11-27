import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8')
}

const { name, version } = JSON.parse(read('package.json'))
const versions = {
  'README.md': read('README.md').match(/^当前版本\s+\x60([^\x60]+)\x60\s*$/m)?.[1],
  'CHANGELOG.md': read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+(?:[-+][\w.+-]+)?)\]/m)?.[1]
}

for (const [file, documented] of Object.entries(versions)) {
  if (documented !== version) {
    console.error(`${file}: ${documented ?? '(missing)'} differs from package.json: ${version}`)
    process.exitCode = 1
  }
}

if (!process.exitCode) console.log(`Version ${version} matches. Expected tarball: ${name}-${version}.tgz`)
