# GitHub Pages Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing mobile motion-ski game at `https://liuyeyang2012-creator.github.io/motion-ski-game-2026/` without routing through `chatgpt.site`.

**Architecture:** Keep the current Vite application unchanged at runtime and add a dedicated Pages build with the repository subpath as its base. GitHub Actions will test, build, validate, upload, and deploy the static `dist/` directory; the pose model and WASM files remain same-origin public assets.

**Tech Stack:** Vite 8, TypeScript 6, Vitest 4, GitHub Actions, GitHub Pages, Git Credential Manager for Windows.

## Global Constraints

- The repository is public and named `motion-ski-game-2026` under `liuyeyang2012-creator`.
- The initial URL is exactly `https://liuyeyang2012-creator.github.io/motion-ski-game-2026/`.
- The Pages base path is exactly `/motion-ski-game-2026/`.
- `.env`, credentials, chat attachments, `node_modules`, `dist`, test reports, and local scratch files must remain untracked.
- Camera frames and pose landmarks stay on the player's device and are never uploaded or persisted.
- The existing Sites build and `chatgpt.site` deployment must continue to work.
- The public pose model and MediaPipe WASM files must load from the same GitHub Pages origin.
- Repository creation and GitHub authentication require the user's authorized GitHub account; never inspect or copy stored credentials.

---

### Task 1: Add a Verified GitHub Pages Build

**Files:**
- Create: `scripts/verify-pages-build.mjs`
- Create: `tests/pages/pages-build.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run build:pages`, which writes a verified static site to `dist/`.
- Produces: `verifyPagesBuild(distDir, basePath): void`, used by both tests and the build command.

- [ ] **Step 1: Write failing build-verifier tests**

Create `tests/pages/pages-build.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run tests/pages/pages-build.test.ts`

Expected: FAIL because `scripts/verify-pages-build.mjs` does not exist.

- [ ] **Step 3: Implement the static build verifier**

Create `scripts/verify-pages-build.mjs`:

```js
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
```

- [ ] **Step 4: Add the dedicated build command**

Add this script to `package.json` without changing `build` or `build:hosting`:

```json
"build:pages": "tsc && vite build --base /motion-ski-game-2026/ && node scripts/verify-pages-build.mjs"
```

- [ ] **Step 5: Run focused and production checks**

Run:

```powershell
npm.cmd test -- --run tests/pages/pages-build.test.ts
npm.cmd run build:pages
npm.cmd run build
git diff --check
```

Expected: the focused tests pass, both Pages and Sites builds exit 0, and `git diff --check` reports no errors.

- [ ] **Step 6: Commit Task 1**

```powershell
git add package.json scripts/verify-pages-build.mjs tests/pages/pages-build.test.ts
git commit -m "build: add verified github pages output"
```

---

### Task 2: Add the GitHub Pages Deployment Workflow

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `tests/pages/pages-build.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm run build:pages` and its verified `dist/` output.
- Produces: a Pages deployment after every push to `master` and on manual dispatch.

- [ ] **Step 1: Add a failing workflow contract test**

Append to `tests/pages/pages-build.test.ts`:

```ts
import { readFileSync } from 'node:fs'

it('deploys the verified dist directory through the official Pages actions', () => {
  const workflow = readFileSync('.github/workflows/pages.yml', 'utf8')
  expect(workflow).toContain('branches: [master]')
  expect(workflow).toContain('pages: write')
  expect(workflow).toContain('id-token: write')
  expect(workflow).toContain('actions/checkout@v6')
  expect(workflow).toContain('actions/setup-node@v6')
  expect(workflow).toContain('npm run build:pages')
  expect(workflow).toContain('actions/upload-pages-artifact@v4')
  expect(workflow).toContain('path: dist')
  expect(workflow).toContain('actions/deploy-pages@v4')
})
```

Keep the existing `mkdirSync` import and add `readFileSync` to that same import declaration rather than creating a duplicate import.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- --run tests/pages/pages-build.test.ts`

Expected: FAIL with `ENOENT` for `.github/workflows/pages.yml`.

- [ ] **Step 3: Create the deployment workflow**

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: [master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test -- --run
      - run: npm run typecheck
      - run: npm run build:pages
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Document the fallback URL**

Add to `README.md` after the introduction:

```markdown
## 在线试玩

- GitHub Pages 备用地址：`https://liuyeyang2012-creator.github.io/motion-ski-game-2026/`
- 如果托管平台拦截当前网络，请优先尝试备用地址。
```

- [ ] **Step 5: Run the full local verification suite**

Run:

```powershell
npm.cmd test -- --run
npm.cmd run typecheck
npm.cmd run build:pages
npm.cmd run build
npm.cmd run test:e2e
git diff --check
```

Expected: all tests pass, both builds and E2E exit 0, and there are no whitespace errors.

- [ ] **Step 6: Commit Task 2**

```powershell
git add .github/workflows/pages.yml tests/pages/pages-build.test.ts README.md
git commit -m "ci: deploy fallback site to github pages"
```

---

### Task 3: Create, Publish, and Verify the Public Repository

**Files:**
- Verify only: tracked repository contents and `dist/`
- External state: public GitHub repository, Git remote, Pages settings, Actions deployment

**Interfaces:**
- Consumes: verified `master` HEAD and `.github/workflows/pages.yml`.
- Produces: `https://liuyeyang2012-creator.github.io/motion-ski-game-2026/`.

- [ ] **Step 1: Recheck the public source boundary**

Run:

```powershell
git status --short
git ls-files .env '.env.*' node_modules dist test-results playwright-report work
git ls-files | Select-String -Pattern 'Tencent Files|nt_qq|Pic/2026' -CaseSensitive:$false
```

Expected: the worktree is clean and both file-list checks return no paths.

- [ ] **Step 2: Authenticate without exposing credentials**

Run `git credential-manager github list`. If `liuyeyang2012-creator` is not listed, run `git credential-manager github login` and pause while the user completes GitHub's own browser authorization. Never print, copy, read, or store a token.

- [ ] **Step 3: Create the empty public repository**

In the authenticated GitHub browser session, create `liuyeyang2012-creator/motion-ski-game-2026` with visibility **Public**. Do not initialize it with a README, `.gitignore`, or license because the local repository already contains history.

- [ ] **Step 4: Push the verified source**

Run:

```powershell
git remote add github https://github.com/liuyeyang2012-creator/motion-ski-game-2026.git
git push -u github master
```

Expected: the pushed remote `master` resolves to the same SHA as local `master`.

- [ ] **Step 5: Enable GitHub Actions as the Pages source**

Open repository **Settings → Pages**, choose **GitHub Actions** as the build and deployment source, then inspect the `Deploy GitHub Pages` workflow. If its first run started before Pages was enabled and failed in `actions/configure-pages`, rerun only that failed workflow after enabling Pages.

- [ ] **Step 6: Wait for the deployment result**

Use the connected GitHub workflow tools or the Actions page to confirm the `Deploy GitHub Pages` run for the pushed commit completes successfully. Do not report the URL while the workflow is queued, running, or failed.

- [ ] **Step 7: Verify the public fallback**

Run this cache-busted public check:

```powershell
$sha = git rev-parse --short HEAD
$base = 'https://liuyeyang2012-creator.github.io/motion-ski-game-2026'
$urls = @(
  "$base/?v=$sha",
  "$base/pose_landmarker.task?v=$sha",
  "$base/vision_wasm_internal.wasm?v=$sha"
)

$responses = $urls | ForEach-Object {
  $response = Invoke-WebRequest -UseBasicParsing $_
  if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode): $_" }
  $response
}

$html = $responses[0].Content
$assetPaths = [regex]::Matches($html, '(?:src|href)="([^"]+\.(?:js|css))"') |
  ForEach-Object { $_.Groups[1].Value } |
  Sort-Object -Unique
if (-not $assetPaths) { throw 'No deployed JavaScript or CSS assets found in HTML.' }
$assetPaths | ForEach-Object {
  $assetUrl = [uri]::new([uri]"$base/", $_).AbsoluteUri
  $response = Invoke-WebRequest -UseBasicParsing "$assetUrl?v=$sha"
  if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode): $assetUrl" }
}
```

Expected: the page, model, WASM, and every discovered JavaScript/CSS asset return HTTP 200. Open the fallback at a mobile viewport and confirm the `开始滑雪` button is visible before handing the link to the user.
