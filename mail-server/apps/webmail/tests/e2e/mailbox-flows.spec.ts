import { expect, test } from '@playwright/test';

import { createSubjectMatcher, getFirstInboxThread, loginAndOpenInbox, openThread, saveEvidence } from './helpers';
import { installMockJmapApi } from './jmap-mock';

test('read flow loads a selected thread into the reader pane', async ({ context, page }) => {
  await installMockJmapApi(page);
  await loginAndOpenInbox(page, context.request);

  const firstThread = await getFirstInboxThread(page);

  await openThread(firstThread.row, page, firstThread.threadId);
  await expect(page.getByTestId('reader-pane')).toContainText(firstThread.subject);
  await expect(page.getByTestId('reader-pane')).toContainText(firstThread.sender);

  await saveEvidence(page, 'playwright-read-flow.png');
});

test('search flow finds a known inbox subject and opens the matching result', async ({ context, page }) => {
  await installMockJmapApi(page);
  await loginAndOpenInbox(page, context.request);

  const firstThread = await getFirstInboxThread(page);

  await page.getByTestId('global-search').fill(firstThread.subject);
  await page.getByTestId('search-submit').click();

  await expect(page).toHaveURL(/\/mail\/search/);
  await expect(page.getByTestId('search-results')).toBeVisible();

  await page.locator('#search-field-select').selectOption('subject');
  await expect(page).toHaveURL(/field=subject/);
  await expect(page.getByTestId('global-search')).toHaveValue(firstThread.subject);

  const resultRow = page.getByTestId('search-results').locator('[data-testid^="thread-row-"]').first();
  await expect(resultRow).toBeVisible();
  await expect(resultRow).toContainText(createSubjectMatcher(firstThread.subject));

  await resultRow.click();
  await expect(page.locator('[data-testid^="message-card-"]').first()).toBeVisible();

  await saveEvidence(page, 'playwright-search-flow.png');
});

test('compose reply flow prefills the draft and returns to the reader after saving', async ({ context, page }) => {
  await installMockJmapApi(page);
  await loginAndOpenInbox(page, context.request);

  const firstThread = await getFirstInboxThread(page);

  await openThread(firstThread.row, page, firstThread.threadId);

  await page.getByTestId('reader-reply').click();

  await expect(page).toHaveURL(/\/mail\/compose/);
  await expect(page.getByTestId('compose-form')).toBeVisible();
  await expect(page.getByTestId('compose-to')).not.toHaveValue('');
  await expect(page.getByTestId('compose-subject')).toHaveValue(createSubjectMatcher(firstThread.subject));

  const composeBody = page.getByTestId('compose-body');
  const quotedBody = await composeBody.inputValue();

  expect(quotedBody.length).toBeGreaterThan(0);

  await composeBody.fill(`Playwright reply draft\n\n${quotedBody}`);

  await Promise.all([
    page.waitForURL(new RegExp(`threadId=${firstThread.threadId}`)),
    page.getByTestId('compose-save-close').click(),
  ]);

  await expect(page.getByTestId('reader-pane')).toContainText(firstThread.subject);
  await expect(page.getByTestId('reader-reply')).toBeVisible();

  await saveEvidence(page, 'playwright-reply-flow.png');
});

test.describe('responsive accessibility coverage', () => {
  test.use({ viewport: { height: 844, width: 390 } });

  test('mobile skip-link navigation stays reachable @responsive @a11y', async ({ context, page }) => {
    await installMockJmapApi(page);
    await loginAndOpenInbox(page, context.request);

    await page.keyboard.press('Tab');

    const skipToThreadList = page.getByRole('link', { name: '跳到线程列表' });

    await expect(skipToThreadList).toBeVisible();

    await skipToThreadList.click();

    await expect(page.locator('#mail-thread-list')).toBeInViewport();
    await expect(page.getByTestId('mailbox-sidebar')).toBeVisible();
    await expect(page.getByTestId('reader-pane')).toBeVisible();

    await saveEvidence(page, 'playwright-responsive-a11y-flow.png');
  });
});
