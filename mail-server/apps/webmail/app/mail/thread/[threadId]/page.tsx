import { redirect } from 'next/navigation';

import { THREAD_LIST_ROUTE_PARAM_THREAD_ID } from '@/lib/jmap/thread-list';

function appendSearchParam(params: URLSearchParams, key: string, value: string | string[] | undefined) {
  if (typeof value === 'string') {
    params.set(key, value);
    return;
  }

  if (Array.isArray(value)) {
    params.delete(key);
    for (const entry of value) {
      params.append(key, entry);
    }
  }
}

export default async function MailThreadCompatibilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ threadId }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (key === 'mailboxId' || key === THREAD_LIST_ROUTE_PARAM_THREAD_ID) {
      continue;
    }

    appendSearchParam(nextSearchParams, key, value);
  }

  nextSearchParams.set(THREAD_LIST_ROUTE_PARAM_THREAD_ID, threadId);

  const mailboxId = typeof resolvedSearchParams.mailboxId === 'string' && resolvedSearchParams.mailboxId.length > 0
    ? resolvedSearchParams.mailboxId
    : null;
  const pathname = mailboxId
    ? `/mail/mailbox/${encodeURIComponent(mailboxId)}`
    : '/mail/inbox';
  const query = nextSearchParams.toString();

  redirect(query.length > 0 ? `${pathname}?${query}` : pathname);
}
