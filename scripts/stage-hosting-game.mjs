import { copyFile } from 'node:fs/promises'

for (const name of [
  'pose_landmarker.task',
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]) {
  await copyFile(`public/${name}`, `hosting-site/public/${name}`)
}
