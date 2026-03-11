import { THREAD_LIST_PAGE_SIZE, THREAD_LIST_ROUTE_PARAM_PAGE, THREAD_LIST_ROUTE_PARAM_THREAD_ID, formatThreadRelativeTime } from '@/lib/jmap/thread-list';
import type { JmapClient, JmapEmailFilterCondition, JmapEmailObject, JmapMailboxObject, JmapQuerySort, JmapThreadObject } from '@/lib/jmap/types';

export const SEARCH_ROUTE_PARAM_QUERY = 'query';
export const SEARCH_ROUTE_PARAM_FIELD = 'field';
export const SEARCH_ROUTE_PARAM_UNREAD = 'unread';
export const SEARCH_ROUTE_PARAM_ATTACHMENT = 'attachment';
export const SEARCH_ROUTE_PARAM_FLAGGED = 'flagged';
export const SEARCH_ROUTE_PARAM_ACCOUNT_ID = 'accountId';
export const SEARCH_ROUTE_PARAM_MAILBOX_ID = 'mailboxId';

export const SEARCH_FIELDS = ['text', 'subject', 'from', 'recipient'] as const;

const SEARCH_ROUTE_ORIGIN = 'https://mail-search.local';
const SEARCH_EMAIL_QUERY_SORT: readonly JmapQuerySort[] = [{ isAscending: false, property: 'receivedAt' }];
const SEARCH_EMAIL_PROPERTIES = ['id', 'from', 'hasAttachment', 'keywords', 'mailboxIds', 'preview', 'receivedAt', 'subject', 'threadId'] as const;
const SEARCH_THREAD_PROPERTIES = ['id', 'emailIds'] as const;
const KEYWORD_FLAGGED = '$flagged';
const KEYWORD_SEEN = '$seen';

export type MailSearchField = (typeof SEARCH_FIELDS)[number];

export interface MailSearchRouteState {
  readonly accountId: string | null;
  readonly field: MailSearchField;
  readonly flaggedOnly: boolean;
  readonly hasAttachment: boolean;
  readonly mailboxId: string | null;
  readonly page: number;
  readonly query: string;
  readonly selectedThreadId: string | null;
  readonly unreadOnly: boolean;
}

export interface SearchThreadRow {
  readonly hasAttachment: boolean;
  readonly id: string;
  readonly isFlagged: boolean;
  readonly isUnread: boolean;
  readonly mailboxId: string | null;
  readonly messageCount: number;
  readonly preview: string;
  readonly receivedAt: string | null;
  readonly relativeTimeLabel: string;
  readonly senderLabel: string;
  readonly subject: string;
}

export interface SearchResultsPageData {
  readonly accountId: string;
  readonly filters: MailSearchRouteState;
  readonly pagination: {
    readonly hasMore: boolean;
    readonly page: number;
    readonly pageSize: number;
    readonly totalLoaded: number;
  };
  readonly rows: readonly SearchThreadRow[];
}

export interface QuerySearchThreadsInput {
  readonly accountId: string;
  readonly client: JmapClient;
  readonly filters: MailSearchRouteState;
  readonly pageSize?: number;
}

interface SearchRepresentative {
  readonly email: JmapEmailObject;
  readonly mailboxId: string | null;
  readonly threadId: string;
}

function isSearchField(value: string | null): value is MailSearchField {
  return value !== null && SEARCH_FIELDS.includes(value as MailSearchField);
}

function readBooleanRouteFlag(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name);
  return value === '1' || value === 'true';
}

function normalizeTextQuery(value: string | null) {
  return value?.trim() ?? '';
}

function normalizeOptionalId(value: string | null) {
  return value && value.trim().length > 0 ? value : null;
}

function normalizePage(value: string | null) {
  const page = Number(value ?? '1');
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

export function resolveSearchRouteState(searchParams: URLSearchParams): MailSearchRouteState {
  return {
    accountId: normalizeOptionalId(searchParams.get(SEARCH_ROUTE_PARAM_ACCOUNT_ID)),
    field: isSearchField(searchParams.get(SEARCH_ROUTE_PARAM_FIELD)) ? (searchParams.get(SEARCH_ROUTE_PARAM_FIELD) as MailSearchField) : 'text',
    flaggedOnly: readBooleanRouteFlag(searchParams, SEARCH_ROUTE_PARAM_FLAGGED),
    hasAttachment: readBooleanRouteFlag(searchParams, SEARCH_ROUTE_PARAM_ATTACHMENT),
    mailboxId: normalizeOptionalId(searchParams.get(SEARCH_ROUTE_PARAM_MAILBOX_ID)),
    page: normalizePage(searchParams.get(THREAD_LIST_ROUTE_PARAM_PAGE)),
    query: normalizeTextQuery(searchParams.get(SEARCH_ROUTE_PARAM_QUERY)),
    selectedThreadId: normalizeOptionalId(searchParams.get(THREAD_LIST_ROUTE_PARAM_THREAD_ID)),
    unreadOnly: readBooleanRouteFlag(searchParams, SEARCH_ROUTE_PARAM_UNREAD),
  };
}

export function hasActiveMailSearchCriteria(state: Pick<MailSearchRouteState, 'field' | 'flaggedOnly' | 'hasAttachment' | 'mailboxId' | 'query' | 'unreadOnly'>) {
  return state.query.length > 0 || state.unreadOnly || state.hasAttachment || state.flaggedOnly || state.mailboxId !== null || state.field !== 'text';
}

export function buildSearchRouteHref(input: MailSearchRouteState & { readonly pathname?: string }) {
  const url = new URL(input.pathname ?? '/mail/search', SEARCH_ROUTE_ORIGIN);

  if (input.accountId) {
    url.searchParams.set(SEARCH_ROUTE_PARAM_ACCOUNT_ID, input.accountId);
  }

  if (input.mailboxId) {
    url.searchParams.set(SEARCH_ROUTE_PARAM_MAILBOX_ID, input.mailboxId);
  }

  if (input.query.length > 0) {
    url.searchParams.set(SEARCH_ROUTE_PARAM_QUERY, input.query);
  }

  if (input.field !== 'text') {
    url.searchParams.set(SEARCH_ROUTE_PARAM_FIELD, input.field);
  }

  if (input.unreadOnly) {
    url.searchParams.set(SEARCH_ROUTE_PARAM_UNREAD, '1');
  }

  if (input.hasAttachment) {
    url.searchParams.set(SEARCH_ROUTE_PARAM_ATTACHMENT, '1');
  }

  if (input.flaggedOnly) {
    url.searchParams.set(SEARCH_ROUTE_PARAM_FLAGGED, '1');
  }

  if (input.page > 1) {
    url.searchParams.set(THREAD_LIST_ROUTE_PARAM_PAGE, String(input.page));
  }

  if (input.selectedThreadId) {
    url.searchParams.set(THREAD_LIST_ROUTE_PARAM_THREAD_ID, input.selectedThreadId);
  }

  return `${url.pathname}${url.search}`;
}

export function createDefaultSearchRouteState(input: { readonly accountId?: string | null; readonly mailboxId?: string | null; readonly pathname?: string }) {
  return buildSearchRouteHref({
    accountId: input.accountId ?? null,
    field: 'text',
    flaggedOnly: false,
    hasAttachment: false,
    mailboxId: input.mailboxId ?? null,
    page: 1,
    pathname: input.pathname,
    query: '',
    selectedThreadId: null,
    unreadOnly: false,
  });
}

export function getSearchFieldLabel(field: MailSearchField) {
  switch (field) {
    case 'from':
      return '发件人';
    case 'recipient':
      return '收件人';
    case 'subject':
      return '主题';
    default:
      return '全文';
  }
}

function normalizeQueryError(message: string) {
  return message.length > 0 ? message : '搜索暂时不可用。';
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

function getRepresentativeMailboxId(email: JmapEmailObject, mailboxId: string | null) {
  const mailboxIds = Object.entries(email.mailboxIds ?? {})
    .filter((entry): entry is [string, boolean] => entry[1] === true)
    .map(([id]) => id);

  if (mailboxId && mailboxIds.includes(mailboxId)) {
    return mailboxId;
  }

  return mailboxIds[0] ?? null;
}

function toThreadMap(threads: readonly JmapThreadObject[]) {
  return new Map(threads.map((thread) => [thread.id, thread]));
}

function toEmailMap(emails: readonly JmapEmailObject[]) {
  return new Map(emails.map((email) => [email.id, email]));
}

function toSearchRow(representative: SearchRepresentative, messageCount: number): SearchThreadRow {
  const { email, mailboxId, threadId } = representative;

  return {
    hasAttachment: email.hasAttachment === true,
    id: threadId,
    isFlagged: email.keywords?.[KEYWORD_FLAGGED] === true,
    isUnread: email.keywords?.[KEYWORD_SEEN] !== true,
    mailboxId,
    messageCount: Math.max(messageCount, 1),
    preview: email.preview?.trim() || '暂无预览摘要',
    receivedAt: email.receivedAt ?? null,
    relativeTimeLabel: formatThreadRelativeTime(email.receivedAt ?? null),
    senderLabel: getSenderLabel(email),
    subject: email.subject?.trim() || '（无主题）',
  };
}

function createFieldFilter(field: MailSearchField, query: string): JmapEmailFilterCondition | null {
  if (query.length === 0) {
    return null;
  }

  switch (field) {
    case 'from':
      return { from: query };
    case 'recipient':
      return {
        conditions: [{ to: query }, { cc: query }, { bcc: query }],
        operator: 'OR',
      };
    case 'subject':
      return { subject: query };
    default:
      return { text: query };
  }
}

function createSearchFilter(filters: MailSearchRouteState): JmapEmailFilterCondition | undefined {
  const conditions: JmapEmailFilterCondition[] = [];
  const fieldFilter = createFieldFilter(filters.field, filters.query);

  if (fieldFilter) {
    conditions.push(fieldFilter);
  }

  if (filters.mailboxId) {
    conditions.push({ inMailbox: filters.mailboxId });
  }

  if (filters.unreadOnly) {
    conditions.push({ notKeyword: KEYWORD_SEEN });
  }

  if (filters.hasAttachment) {
    conditions.push({ hasAttachment: true });
  }

  if (filters.flaggedOnly) {
    conditions.push({ keyword: KEYWORD_FLAGGED });
  }

  if (conditions.length === 0) {
    return undefined;
  }

  return conditions.length === 1 ? conditions[0] : { conditions, operator: 'AND' };
}

export function resolveSearchMailboxName(mailboxes: readonly JmapMailboxObject[], mailboxId: string | null) {
  if (!mailboxId) {
    return '全部邮箱';
  }

  return mailboxes.find((mailbox) => mailbox.id === mailboxId)?.name ?? '指定邮箱';
}

export async function querySearchThreads(input: QuerySearchThreadsInput): Promise<SearchResultsPageData> {
  const requestedPage = Math.max(1, Math.floor(input.filters.page));
  const pageSize = input.pageSize ?? THREAD_LIST_PAGE_SIZE;
  const requestedCount = requestedPage * pageSize;
  const queryLimit = Math.max(pageSize * 2, 32);
  const filter = createSearchFilter(input.filters);
  const representatives = new Map<string, SearchRepresentative>();

  if (!filter) {
    return {
      accountId: input.accountId,
      filters: input.filters,
      pagination: {
        hasMore: false,
        page: requestedPage,
        pageSize,
        totalLoaded: 0,
      },
      rows: [],
    };
  }

  let hasMoreEmails = true;
  let position = 0;

  while (representatives.size <= requestedCount && hasMoreEmails) {
    const queryResult = await input.client.email.query({
      accountId: input.accountId,
      filter,
      limit: queryLimit,
      position,
      sort: SEARCH_EMAIL_QUERY_SORT,
    });

    if (!queryResult.ok) {
      throw new Error(normalizeQueryError(queryResult.error.message));
    }

    const queryResponse = ensureSuccessResult(queryResult.result, '搜索查询失败。');
    const ids = queryResponse.ids;

    if (ids.length === 0) {
      hasMoreEmails = false;
      break;
    }

    const getResult = await input.client.email.get({
      accountId: input.accountId,
      ids,
      properties: SEARCH_EMAIL_PROPERTIES,
    });

    if (!getResult.ok) {
      throw new Error(normalizeQueryError(getResult.error.message));
    }

    const getResponse = ensureSuccessResult(getResult.result, '搜索结果读取失败。');
    const emailsById = toEmailMap(getResponse.list);

    for (const emailId of ids) {
      const email = emailsById.get(emailId);

      if (!email?.threadId || representatives.has(email.threadId)) {
        continue;
      }

      representatives.set(email.threadId, {
        email,
        mailboxId: getRepresentativeMailboxId(email, input.filters.mailboxId),
        threadId: email.threadId,
      });
    }

    position += ids.length;
    hasMoreEmails = ids.length === queryLimit;
  }

  const orderedThreadIds = [...representatives.keys()];
  const visibleThreadIds = orderedThreadIds.slice(0, requestedCount);
  const threadCountById = new Map<string, number>();

  if (visibleThreadIds.length > 0) {
    const threadGetResult = await input.client.thread.get({
      accountId: input.accountId,
      ids: visibleThreadIds,
      properties: SEARCH_THREAD_PROPERTIES,
    });

    if (!threadGetResult.ok) {
      throw new Error(normalizeQueryError(threadGetResult.error.message));
    }

    const threadGetResponse = ensureSuccessResult(threadGetResult.result, '搜索线程详情读取失败。');
    const threadMap = toThreadMap(threadGetResponse.list);

    for (const threadId of visibleThreadIds) {
      threadCountById.set(threadId, threadMap.get(threadId)?.emailIds?.length ?? 1);
    }
  }

  const rows = visibleThreadIds
    .map((threadId) => {
      const representative = representatives.get(threadId);
      return representative ? toSearchRow(representative, threadCountById.get(threadId) ?? 1) : null;
    })
    .filter((row): row is SearchThreadRow => row !== null);

  return {
    accountId: input.accountId,
    filters: input.filters,
    pagination: {
      hasMore: orderedThreadIds.length > requestedCount || hasMoreEmails,
      page: requestedPage,
      pageSize,
      totalLoaded: rows.length,
    },
    rows,
  };
}
