import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const requiredFiles = [
  'index.html',
  'pose_landmarker.task',
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

export function verifyPagesBuild(distDir = resolve('dist'), basePath = '/motion-ski-game-2026/') {
  for (const file of requiredFiles) {
    const path = resolve(distDir, file)
    if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing or empty Pages asset: ${file}`)
  }
  const html = readFileSync(resolve(distDir, 'index.html'), 'utf8')
  if (!html.includes(`${basePath}assets/`)) throw new Error(`Pages base path is missing from index.html: ${basePath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyPagesBuild()
  console.log('GitHub Pages build verified')
}
