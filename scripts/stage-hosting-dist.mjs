import { cp, rm } from 'node:fs/promises'

await rm('dist', { recursive: true, force: true })
await cp('hosting-site/dist', 'dist', { recursive: true })
