import { expect, test } from '@playwright/test'

test('completes a seated quick session without external uploads', async ({ page }) => {
  const unsafeRequests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4173' || request.postData()) unsafeRequests.push(request.url())
  })
  await page.goto('/?poseFixture=seated-quick-success')
  await page.getByRole('button', { name: '开始滑雪' }).click()
  await page.getByLabel('坐姿模式').check()
  await page.getByLabel('30 秒快速局').check()
  await page.getByRole('button', { name: '开始校准' }).click()
  await expect(page.getByText('校准完成')).toBeVisible()
  await expect(page.getByText('本次身体活动')).toBeVisible({ timeout: 8_000 })
  expect(unsafeRequests).toEqual([])
})
