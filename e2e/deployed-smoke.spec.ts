import { expect, test } from '@playwright/test'

const publicBaseURL = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '')

test.skip(!publicBaseURL, 'PUBLIC_BASE_URL is required for the deployed smoke test')

test('runs the seated and standing public fixture entries', async ({ page }) => {
  await page.goto(`${publicBaseURL}/?poseFixture=seated-soft-success`)
  await page.getByRole('button', { name: '开始滑雪' }).click()
  await page.getByLabel('坐姿模式').check()
  await page.getByRole('button', { name: '开始校准' }).click()

  await expect(page.locator('.head-calibration-guide')).toBeVisible()
  await expect(page.locator('[data-guide-point]')).toHaveCount(5)
  await expect(page.locator('.pose-overlay')).toHaveCount(0)
  await expect(page.getByText('请正对手机')).toBeVisible()
  await expect(page.getByText('校准完成')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('转头变道 · 抬头跳跃 · 低头躲避')).toBeVisible()

  await page.goto(`${publicBaseURL}/?poseFixture=standing-soft-success`)
  await page.getByRole('button', { name: '开始滑雪' }).click()
  await page.getByLabel('站立模式').check()
  await page.getByRole('button', { name: '开始校准' }).click()

  await expect(page.locator('.calibration-frame.full-body')).toBeVisible()
  await expect(page.locator('.pose-overlay')).toBeVisible()
  await expect(page.locator('.head-calibration-guide')).toHaveCount(0)
})
