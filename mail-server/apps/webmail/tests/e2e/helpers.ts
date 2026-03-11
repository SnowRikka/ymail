import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const EVIDENCE_DIR = path.join(process.cwd(), '.sisyphus', 'evidence');
const THREAD_ROW_PREFIX = 'thread-row-';

export interface ThreadSummary {
  readonly row: Locator;
  readonly sender: string;
  readonly subject: string;
  readonly threadId: string;
}

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getThreadId(value: string | null) {
  if (!value?.startsWith(THREAD_ROW_PREFIX)) {
    throw new Error(`Unable to read thread id from ${String(value)}.`);
  }

  return value.slice(THREAD_ROW_PREFIX.length);
}

export function createSubjectMatcher(subject: string) {
  return new RegExp(escapeForRegExp(subject));
}

export async function createTestSession(request: APIRequestContext, username = 'alice@example.com') {
  const response = await request.post('/api/test/session', {
    data: { username },
  });

  expect(response.ok()).toBeTruthy();
}

export async function loginAndOpenInbox(page: Page, request: APIRequestContext) {
  await page.goto('/mail/inbox');
  await expect(page).toHaveURL(/\/login\?next=%2Fmail%2Finbox$/);
  await expect(page.getByTestId('login-form')).toBeVisible();

  await createTestSession(request);

  await page.goto('/mail/inbox');
  await expect(page).toHaveURL(/\/mail\/inbox$/);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('thread-list')).toBeVisible();
}

export async function getFirstInboxThread(page: Page): Promise<ThreadSummary> {
  const row = page.getByTestId('thread-list').locator(`[data-testid^="${THREAD_ROW_PREFIX}"]`).first();

  await expect(row).toBeVisible();

  const threadId = getThreadId(await row.getAttribute('data-testid'));
  const sender = (await row.locator('span').allTextContents()).map((value) => value.trim()).find((value) => value.length > 0) ?? '';
  const subject = (await row.locator('p').nth(0).textContent())?.trim() ?? '';

  expect(subject.length).toBeGreaterThan(0);

  return {
    row,
    sender,
    subject,
    threadId,
  };
}

export async function openThread(row: Locator, page: Page, threadId: string) {
  await row.click();
  await expect(page).toHaveURL(new RegExp(`threadId=${escapeForRegExp(threadId)}`));
  await expect(page.locator('[data-testid^="message-card-"]').first()).toBeVisible();
  await expect(page.getByTestId('reader-reply')).toBeVisible();
}

export async function saveEvidence(page: Page, fileName: string) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: path.join(EVIDENCE_DIR, fileName),
  });
}
