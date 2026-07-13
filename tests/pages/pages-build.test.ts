import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyPagesBuild } from '../../scripts/verify-pages-build.mjs'

const base = '/motion-ski-game-2026/'

function pagesDist(scriptSrc = `${base}assets/index.js`): string {
  const dist = mkdtempSync(join(tmpdir(), 'motion-ski-pages-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), `<script type="module" src="${scriptSrc}"></script>`)
  for (const file of [
    'pose_landmarker.task',
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm',
  ]) writeFileSync(join(dist, file), file)
  return dist
}

describe('GitHub Pages build contract', () => {
  it('accepts a complete build rooted at the repository subpath', () => {
    expect(() => verifyPagesBuild(pagesDist(), base)).not.toThrow()
  })

  it('rejects a root-relative bundle that would break on project Pages', () => {
    expect(() => verifyPagesBuild(pagesDist('/assets/index.js'), base)).toThrow('Pages base path')
  })

  it('rejects a build missing the on-device pose assets', () => {
    const dist = pagesDist()
    writeFileSync(join(dist, 'pose_landmarker.task'), '')
    expect(() => verifyPagesBuild(dist, base)).toThrow('pose_landmarker.task')
  })
})

it('deploys the verified dist directory through the official Pages actions', () => {
  const workflow = readFileSync('.github/workflows/pages.yml', 'utf8')
  expect(workflow).toContain('branches: [master]')
  expect(workflow).toContain('pages: write')
  expect(workflow).toContain('id-token: write')
  expect(workflow).toContain('actions/checkout@v6')
  expect(workflow).toContain('actions/setup-node@v6')
  expect(workflow).toContain('npm run build:pages')
  expect(workflow).toContain('actions/configure-pages@v6')
  expect(workflow).toContain('actions/upload-pages-artifact@v4')
  expect(workflow).toContain('path: dist')
  expect(workflow).toContain('actions/deploy-pages@v4')
})
