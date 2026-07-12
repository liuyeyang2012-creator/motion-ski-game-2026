import { cp, readdir, rm } from 'node:fs/promises'

for (const name of ['assets', 'index.html', 'pose_landmarker.task', 'vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  await rm(`hosting-site/public/${name}`, { recursive: true, force: true })
}
for (const name of await readdir('dist')) {
  await cp(`dist/${name}`, `hosting-site/public/${name}`, { recursive: true })
}
