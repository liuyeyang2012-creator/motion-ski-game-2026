import { expect, test, type Page } from '@playwright/test'

async function beginCalibration(page: Page, fixture: string, style: 'seated' | 'standing' = 'seated'): Promise<void> {
  await page.goto(`/?poseFixture=${fixture}`)
  await page.getByRole('button', { name: '开始滑雪' }).click()
  await page.getByLabel(style === 'seated' ? '坐姿模式' : '站立模式').check()
  await page.getByLabel('30 秒快速局').check()
  await page.getByRole('button', { name: '开始校准' }).click()
}

test('drives every seated head-control event through the game without external uploads', async ({ page }) => {
  const unsafeRequests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4173' || request.postData()) unsafeRequests.push(request.url())
  })
  await beginCalibration(page, 'seated-quick-success')

  await expect(page.locator('.head-calibration-guide')).toBeVisible()
  await expect(page.locator('[data-guide-point]')).toHaveCount(5)
  await expect(page.locator('.pose-overlay')).toHaveCount(0)
  await expect(page.getByText('请正对手机')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-fixture-calibration-successes', '1,2,3,4,5')
  await expect(page.getByText('校准完成')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('转头变道 · 抬头跳跃 · 低头躲避')).toBeVisible()

  const shell = page.locator('.app-shell')
  await expect(shell).toHaveAttribute('data-fixture-last-motion', 'turn-left')
  await expect(shell).toHaveAttribute('data-fixture-player-lane', '-1')
  await expect(shell).toHaveAttribute('data-fixture-resolved-obstacle', 'lane')

  await expect(shell).toHaveAttribute('data-fixture-last-motion', 'turn-right')
  await expect(shell).toHaveAttribute('data-fixture-player-lane', '0')
  await expect(shell).toHaveAttribute('data-fixture-resolved-obstacle', 'lane')

  await expect(shell).toHaveAttribute('data-fixture-last-motion', 'head-up')
  await expect(shell).toHaveAttribute('data-fixture-player-action', 'jump')
  await expect(shell).toHaveAttribute('data-fixture-resolved-obstacle', 'jump')

  await expect(shell).toHaveAttribute('data-fixture-last-motion', 'head-down')
  await expect(shell).toHaveAttribute('data-fixture-player-action', 'duck')
  await expect(shell).toHaveAttribute('data-fixture-resolved-obstacle', 'duck')
  await expect(shell).toHaveAttribute('data-fixture-collisions', '0')

  await expect(page.getByText('本次身体活动')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText(/转头变道 2 次/)).toBeVisible()
  await expect(page.getByText(/跳跃 1 次/)).toBeVisible()
  await expect(page.getByText(/俯身 1 次/)).toBeVisible()
  expect(unsafeRequests).toEqual([])
})

test('shows a realistic head guide and completes soft seated calibration', async ({ page }) => {
  await beginCalibration(page, 'seated-soft-success')

  await expect(page.locator('.head-calibration-guide')).toBeVisible()
  await expect(page.locator('[data-guide-point]')).toHaveCount(5)
  await expect(page.locator('.pose-overlay')).toHaveCount(0)
  await expect(page.getByText('请正对手机')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-fixture-calibration-successes', '1,2,3,4,5')
  await expect(page.getByText('校准完成')).toBeVisible({ timeout: 8_000 })
})

test('recommended sensitivity escapes a stuck action with recordable evidence', async ({ page }) => {
  await beginCalibration(page, 'seated-stuck-action')

  await expect(page.getByRole('button', { name: '重新识别' })).toBeVisible()
  await expect(page.getByRole('button', { name: '使用推荐灵敏度' })).toBeVisible()
  await page.getByRole('button', { name: '使用推荐灵敏度' }).click()

  await expect(page.getByText(/动作校准 2\/5/)).toBeVisible()
  await expect(page.getByText('校准成功')).toBeVisible()
})

test('body-only evidence cannot recommend skipping a seated head action', async ({ page }) => {
  await beginCalibration(page, 'seated-body-only')

  await expect(page.getByRole('button', { name: '重新识别' })).toBeVisible()
  await expect(page.getByRole('button', { name: '使用推荐灵敏度' })).toBeVisible()
  await page.getByRole('button', { name: '使用推荐灵敏度' }).click()

  await expect(page.getByText(/动作校准 2\/5/)).toBeVisible()
  await expect(page.getByText('向左转头')).toBeVisible()
  await expect(page.getByText('校准成功')).toHaveCount(0)
})

test('keeps the standing full-body entry and completes its game flow', async ({ page }) => {
  await beginCalibration(page, 'standing-soft-success', 'standing')

  await expect(page.locator('.calibration-frame.full-body')).toBeVisible()
  await expect(page.locator('.pose-overlay')).toBeVisible()
  await expect(page.locator('.head-calibration-guide')).toHaveCount(0)
  await expect(page.locator('.app-shell')).toHaveAttribute('data-fixture-calibration-successes', '1,2,3,4,5')
  await expect(page.getByText('校准完成')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('侧身变道 · 低头过门 · 抬手加速')).toBeVisible()
  await expect(page.getByText('本次身体活动')).toBeVisible({ timeout: 8_000 })
})
