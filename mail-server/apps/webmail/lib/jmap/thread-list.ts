import type { JmapClient, JmapEmailObject, JmapQuerySort, JmapThreadObject } from '@/lib/jmap/types';

export const THREAD_LIST_PAGE_SIZE = 24;
export const THREAD_LIST_ROUTE_PARAM_PAGE = 'threadPage';
export const THREAD_LIST_ROUTE_PARAM_THREAD_ID = 'threadId';

export const THREAD_LIST_EMAIL_QUERY_SORT: readonly JmapQuerySort[] = [{ isAscending: false, property: 'receivedAt' }];
const EMAIL_PROPERTIES = ['id', 'from', 'hasAttachment', 'keywords', 'mailboxIds', 'preview', 'receivedAt', 'subject', 'threadId'] as const;
const THREAD_PROPERTIES = ['id', 'emailIds'] as const;
const KEYWORD_FLAGGED = '$flagged';
const KEYWORD_SEEN = '$seen';
const ROUTE_ORIGIN = 'https://thread-list.local';

export interface ThreadListRouteState {
  readonly page: number;
  readonly selectedThreadId: string | null;
}

export interface ThreadListRow {
  readonly emailId: string;
  readonly emailIds: readonly string[];
  readonly hasAttachment: boolean;
  readonly id: string;
  readonly isFlagged: boolean;
  readonly isUnread: boolean;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
  readonly messageCount: number;
  readonly preview: string;
  readonly receivedAt: string | null;
  readonly relativeTimeLabel: string;
  readonly senderLabel: string;
  readonly subject: string;
}

export interface ThreadListPageData {
  readonly accountId: string;
  readonly mailboxId: string;
  readonly pagination: {
    readonly hasMore: boolean;
    readonly page: number;
    readonly pageSize: number;
    readonly totalLoaded: number;
  };
  readonly rows: readonly ThreadListRow[];
  readonly sync: {
    readonly emailQueryState: string;
    readonly threadState: string | null;
  };
}

export interface QueryMailboxThreadsInput {
  readonly accountId: string;
  readonly client: JmapClient;
  readonly mailboxId: string;
  readonly page: number;
  readonly pageSize?: number;
}

interface ThreadRepresentative {
  readonly email: JmapEmailObject;
  readonly threadId: string;
}

export function resolveThreadListRouteState(searchParams: URLSearchParams): ThreadListRouteState {
  const rawPage = Number(searchParams.get(THREAD_LIST_ROUTE_PARAM_PAGE) ?? '1');
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const selectedThreadId = searchParams.get(THREAD_LIST_ROUTE_PARAM_THREAD_ID);

  return {
    page,
    selectedThreadId: selectedThreadId && selectedThreadId.length > 0 ? selectedThreadId : null,
  };
}

export function buildThreadRouteHref(
  baseHref: string,
  input: {
    readonly page: number;
    readonly selectedThreadId?: string | null;
  },
) {
  const url = new URL(baseHref, ROUTE_ORIGIN);

  url.searchParams.set(THREAD_LIST_ROUTE_PARAM_PAGE, String(Math.max(1, Math.floor(input.page))));

  if (input.selectedThreadId && input.selectedThreadId.length > 0) {
    url.searchParams.set(THREAD_LIST_ROUTE_PARAM_THREAD_ID, input.selectedThreadId);
  } else {
    url.searchParams.delete(THREAD_LIST_ROUTE_PARAM_THREAD_ID);
  }

  return `${url.pathname}${url.search}`;
}

export function formatThreadRelativeTime(receivedAt: string | null | undefined, now = new Date()) {
  if (!receivedAt) {
    return '未知时间';
  }

  const parsed = new Date(receivedAt);

  if (Number.isNaN(parsed.getTime())) {
    return '未知时间';
  }

  const elapsedMilliseconds = parsed.getTime() - now.getTime();
  const elapsedMinutes = Math.round(elapsedMilliseconds / (1000 * 60));
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });

  if (Math.abs(elapsedMinutes) < 60) {
    return formatter.format(elapsedMinutes, 'minute');
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);

  if (Math.abs(elapsedHours) < 24) {
    return formatter.format(elapsedHours, 'hour');
  }

  const elapsedDays = Math.round(elapsedHours / 24);

  if (Math.abs(elapsedDays) < 7) {
    return formatter.format(elapsedDays, 'day');
  }

  const elapsedWeeks = Math.round(elapsedDays / 7);

  if (Math.abs(elapsedWeeks) < 5) {
    return formatter.format(elapsedWeeks, 'week');
  }

  const elapsedMonths = Math.round(elapsedDays / 30);

  if (Math.abs(elapsedMonths) < 12) {
    return formatter.format(elapsedMonths, 'month');
  }

  return formatter.format(Math.round(elapsedDays / 365), 'year');
}

function normalizeQueryError(message: string) {
  return message.length > 0 ? message : '线程列表暂时不可用。';
}

function ensureSuccessResult<Response>(
  result: { readonly kind: 'method-error'; readonly error: { readonly description?: string } } | { readonly kind: 'success'; readonly response: Response },
  fallbackMessage: string,
): Response {
  if (result.kind !== 'success') {
    throw new Error(normalizeQueryError(result.error.description ?? fallbackMessage));
  }

  return result.response;
}

function getSenderLabel(email: JmapEmailObject) {
  const firstSender = email.from?.[0];
  const name = typeof firstSender?.name === 'string' ? firstSender.name.trim() : '';

  if (name.length > 0) {
    return name;
  }

  const address = typeof firstSender?.email === 'string' ? firstSender.email.trim() : '';

  return address.length > 0 ? address : '未知发件人';
}

function toThreadListRow(representative: ThreadRepresentative, emailIds: readonly string[], messageCount: number): ThreadListRow {
  const { email, threadId } = representative;

  return {
    emailId: email.id,
    emailIds,
    hasAttachment: email.hasAttachment === true,
    id: threadId,
    isFlagged: email.keywords?.[KEYWORD_FLAGGED] === true,
    isUnread: email.keywords?.[KEYWORD_SEEN] !== true,
    mailboxIds: email.mailboxIds ?? {},
    messageCount: Math.max(messageCount, 1),
    preview: email.preview?.trim() || '暂无预览摘要',
    receivedAt: email.receivedAt ?? null,
    relativeTimeLabel: formatThreadRelativeTime(email.receivedAt ?? null),
    senderLabel: getSenderLabel(email),
    subject: email.subject?.trim() || '（无主题）',
  };
}

function toEmailMap(emails: readonly JmapEmailObject[]) {
  return new Map(emails.map((email) => [email.id, email]));
}

function toThreadMap(threads: readonly JmapThreadObject[]) {
  return new Map(threads.map((thread) => [thread.id, thread]));
}

export async function queryMailboxThreads(input: QueryMailboxThreadsInput): Promise<ThreadListPageData> {
  const requestedPage = Math.max(1, Math.floor(input.page));
  const pageSize = input.pageSize ?? THREAD_LIST_PAGE_SIZE;
  const requestedCount = requestedPage * pageSize;
  const queryLimit = Math.max(pageSize * 2, 32);
  const representatives = new Map<string, ThreadRepresentative>();

  let position = 0;
  let hasMoreEmails = true;
  let emailQueryState = '';

  while (representatives.size <= requestedCount && hasMoreEmails) {
    const queryResult = await input.client.email.query({
      accountId: input.accountId,
      filter: {
        inMailbox: input.mailboxId,
      },
      limit: queryLimit,
      position,
        sort: THREAD_LIST_EMAIL_QUERY_SORT,
    });

    if (!queryResult.ok) {
      throw new Error(normalizeQueryError(queryResult.error.message));
    }

    const queryResponse = ensureSuccessResult(queryResult.result, '线程查询失败。');
    emailQueryState = queryResponse.queryState;
    const ids = queryResponse.ids;

    if (ids.length === 0) {
      hasMoreEmails = false;
      break;
    }

    const getResult = await input.client.email.get({
      accountId: input.accountId,
      ids,
      properties: EMAIL_PROPERTIES,
    });

    if (!getResult.ok) {
      throw new Error(normalizeQueryError(getResult.error.message));
    }

    const getResponse = ensureSuccessResult(getResult.result, '线程摘要读取失败。');
    const emailsById = toEmailMap(getResponse.list);

    for (const emailId of ids) {
      const email = emailsById.get(emailId);

      if (!email?.threadId || representatives.has(email.threadId)) {
        continue;
      }

      representatives.set(email.threadId, {
        email,
        threadId: email.threadId,
      });
    }

    position += ids.length;
    hasMoreEmails = ids.length === queryLimit;
  }

  const orderedThreadIds = [...representatives.keys()];
  const visibleThreadIds = orderedThreadIds.slice(0, requestedCount);
  const threadCountById = new Map<string, number>();
  const threadEmailIdsById = new Map<string, readonly string[]>();
  let threadState: string | null = null;

  if (visibleThreadIds.length > 0) {
    const threadGetResult = await input.client.thread.get({
      accountId: input.accountId,
      ids: visibleThreadIds,
      properties: THREAD_PROPERTIES,
    });

    if (!threadGetResult.ok) {
      throw new Error(normalizeQueryError(threadGetResult.error.message));
    }

    const threadGetResponse = ensureSuccessResult(threadGetResult.result, '线程详情读取失败。');
    threadState = threadGetResponse.state;
    const threadMap = toThreadMap(threadGetResponse.list);

    for (const threadId of visibleThreadIds) {
      const emailIds = threadMap.get(threadId)?.emailIds ?? [];
      threadCountById.set(threadId, emailIds.length || 1);
      threadEmailIdsById.set(threadId, emailIds);
    }
  }

  const rows = visibleThreadIds
    .map((threadId) => {
      const representative = representatives.get(threadId);

      if (!representative) {
        return null;
      }

      return toThreadListRow(representative, threadEmailIdsById.get(threadId) ?? [], threadCountById.get(threadId) ?? 1);
    })
    .filter((row): row is ThreadListRow => row !== null);

  return {
    accountId: input.accountId,
    mailboxId: input.mailboxId,
    pagination: {
      hasMore: orderedThreadIds.length > requestedCount || hasMoreEmails,
      page: requestedPage,
      pageSize,
      totalLoaded: rows.length,
    },
    rows,
    sync: {
      emailQueryState,
      threadState,
    },
  };
}
