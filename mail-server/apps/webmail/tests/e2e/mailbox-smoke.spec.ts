import { expect, test } from '@playwright/test';

test('mailbox routes redirect unauthenticated users and render inbox after test login', async ({ context, page }) => {
  await page.goto('/mail/inbox');

  await expect(page).toHaveURL(/\/login\?next=%2Fmail%2Finbox$/);
  await expect(page.getByTestId('login-form')).toBeVisible();

  const loginResponse = await context.request.post('/api/test/session', {
    data: {
      username: 'alice@example.com',
    },
  });

  expect(loginResponse.ok()).toBeTruthy();

  await page.goto('/mail/inbox');

  await expect(page).toHaveURL(/\/mail\/inbox$/);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByText('收件箱')).toBeVisible();
});
