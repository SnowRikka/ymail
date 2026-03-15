import { redirect } from 'next/navigation';

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

export default async function MailDraftsCompatibilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (key === 'mailboxId') {
      continue;
    }

    appendSearchParam(nextSearchParams, key, value);
  }

  const mailboxId = typeof resolvedSearchParams.mailboxId === 'string' && resolvedSearchParams.mailboxId.length > 0
    ? resolvedSearchParams.mailboxId
    : null;
  const pathname = mailboxId
    ? `/mail/mailbox/${encodeURIComponent(mailboxId)}`
    : '/mail/inbox';
  const query = nextSearchParams.toString();

  redirect(query.length > 0 ? `${pathname}?${query}` : pathname);
}
