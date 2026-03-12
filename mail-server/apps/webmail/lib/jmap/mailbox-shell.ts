import type { JmapClient, JmapMailboxObject, JmapQuerySort, JmapSessionAccount, JmapSessionResource } from '@/lib/jmap/types';

export const MAILBOX_ROLE_ORDER = ['inbox', 'sent', 'drafts', 'junk', 'trash', 'archive', 'important', 'scheduled', 'snoozed', 'memos', 'shared'] as const;

export type MailboxRole = (typeof MAILBOX_ROLE_ORDER)[number];

export interface MailboxAccountOption {
  readonly id: string;
  readonly isPersonal: boolean;
  readonly isReadOnly: boolean;
  readonly label: string;
  readonly name: string;
}

export interface MailboxPathContext {
  readonly allowFallbackSelection: boolean;
  readonly mailboxId: string | null;
  readonly role: MailboxRole | null;
}

export interface MailboxNavigationItem {
  readonly accountId: string;
  readonly depth: number;
  readonly href: string;
  readonly id: string;
  readonly isActive: boolean;
  readonly kind: 'custom' | 'system';
  readonly name: string;
  readonly role: MailboxRole | null;
  readonly totalCount: number;
  readonly unreadCount: number;
}

export interface MailboxShellViewModel {
  readonly accounts: readonly MailboxAccountOption[];
  readonly activeAccountId: string | null;
  readonly activeAccountLabel: string;
  readonly activeMailboxId: string | null;
  readonly activeMailboxName: string;
  readonly activeMailboxRole: MailboxRole | null;
  readonly customItems: readonly MailboxNavigationItem[];
  readonly hasMultipleAccounts: boolean;
  readonly mailboxItems: readonly MailboxNavigationItem[];
  readonly systemItems: readonly MailboxNavigationItem[];
  readonly totalUnread: number;
  readonly username: string;
}

export interface MailboxCollectionData {
  readonly accountId: string;
  readonly ids: readonly string[];
  readonly list: readonly JmapMailboxObject[];
  readonly state: string;
}

export interface BuildMailboxShellViewModelInput {
  readonly accountId: string;
  readonly mailboxes: readonly JmapMailboxObject[];
  readonly pathname: string;
  readonly searchMailboxId?: string | null;
  readonly session: JmapSessionResource;
}

const MAILBOX_ROLE_LABELS: Record<MailboxRole, string> = {
  archive: '归档',
  drafts: '草稿',
  important: '重要',
  inbox: '收件箱',
  junk: '垃圾邮件',
  memos: '备忘',
  scheduled: '定时',
  sent: '已发送',
  shared: '共享',
  snoozed: '稍后处理',
  trash: '废纸篓',
};

export const MAILBOX_PROPERTIES = ['id', 'isSubscribed', 'name', 'parentId', 'role', 'sortOrder', 'totalEmails', 'totalThreads', 'unreadEmails', 'unreadThreads'] as const;
export const MAILBOX_QUERY_SORT: readonly JmapQuerySort[] = [
  { isAscending: true, property: 'sortOrder' },
  { isAscending: true, property: 'name' },
];

const MAILBOX_ROLE_RANK = new Map<MailboxRole, number>(MAILBOX_ROLE_ORDER.map((role, index) => [role, index]));

export function isMailboxRole(value: string | null | undefined): value is MailboxRole {
  return typeof value === 'string' && MAILBOX_ROLE_RANK.has(value as MailboxRole);
}

export function resolveMailboxPathContext(pathname: string, searchMailboxId?: string | null): MailboxPathContext {
  if (pathname === '/mail/inbox') {
    return {
      allowFallbackSelection: true,
      mailboxId: searchMailboxId ?? null,
      role: 'inbox',
    };
  }

  if (pathname === '/mail/search') {
    return {
      allowFallbackSelection: searchMailboxId !== null && searchMailboxId !== undefined,
      mailboxId: searchMailboxId ?? null,
      role: null,
    };
  }

  const dynamicMatch = pathname.match(/^\/mail\/mailbox\/([^/?#]+)/);

  return {
    allowFallbackSelection: true,
    mailboxId: dynamicMatch ? decodeURIComponent(dynamicMatch[1]) : (searchMailboxId ?? null),
    role: null,
  };
}

export function toMailboxAccountOptions(session: JmapSessionResource): readonly MailboxAccountOption[] {
  return Object.values(session.accounts)
    .filter((account) => account.accountCapabilities.mail.supported)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    .map((account) => ({
      id: account.id,
      isPersonal: account.isPersonal,
      isReadOnly: account.isReadOnly,
      label: account.isReadOnly ? `${account.name} · 只读` : account.name,
      name: account.name,
    }));
}

export function resolveMailboxAccountId(session: JmapSessionResource, preferredAccountId?: string | null): string | null {
  const accountOptions = toMailboxAccountOptions(session);

  if (preferredAccountId) {
    const preferredAccount = accountOptions.find((account) => account.id === preferredAccountId);
    if (preferredAccount) {
      return preferredAccount.id;
    }
  }

  const primaryMailAccountId = session.primaryAccounts.mail;
  const primaryMailAccount = primaryMailAccountId
    ? accountOptions.find((account) => account.id === primaryMailAccountId)
    : null;

  return primaryMailAccount?.id ?? accountOptions[0]?.id ?? null;
}

function getAccountLabel(account: JmapSessionAccount | undefined) {
  if (!account) {
    return '无可用账号';
  }

  return account.isReadOnly ? `${account.name} · 只读` : account.name;
}

function compareMailboxName(left: JmapMailboxObject, right: JmapMailboxObject) {
  return (left.name ?? '').localeCompare(right.name ?? '', 'zh-CN');
}

function compareMailboxSort(left: JmapMailboxObject, right: JmapMailboxObject) {
  const sortDelta = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
  return sortDelta !== 0 ? sortDelta : compareMailboxName(left, right);
}

function buildMailboxHref(accountId: string, mailbox: JmapMailboxObject) {
  const accountQuery = `accountId=${encodeURIComponent(accountId)}`;

  if (mailbox.role === 'inbox') {
    return `/mail/inbox?${accountQuery}&mailboxId=${encodeURIComponent(mailbox.id)}`;
  }

  return `/mail/mailbox/${encodeURIComponent(mailbox.id)}?${accountQuery}`;
}

function getMailboxName(mailbox: JmapMailboxObject) {
  if (mailbox.name && mailbox.name.trim().length > 0) {
    return mailbox.name;
  }

  return isMailboxRole(mailbox.role) ? MAILBOX_ROLE_LABELS[mailbox.role] : '未命名文件夹';
}

function partitionMailboxes(mailboxes: readonly JmapMailboxObject[]) {
  const system = mailboxes
    .filter((mailbox) => isMailboxRole(mailbox.role))
    .sort((left, right) => {
      const leftRank = MAILBOX_ROLE_RANK.get(left.role as MailboxRole) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = MAILBOX_ROLE_RANK.get(right.role as MailboxRole) ?? Number.MAX_SAFE_INTEGER;

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return compareMailboxSort(left, right);
    });

  const customMailboxes = mailboxes.filter((mailbox) => !isMailboxRole(mailbox.role));
  const childrenByParentId = new Map<string, JmapMailboxObject[]>();
  const customRoots: JmapMailboxObject[] = [];

  for (const mailbox of customMailboxes) {
    if (mailbox.parentId && customMailboxes.some((candidate) => candidate.id === mailbox.parentId)) {
      const siblings = childrenByParentId.get(mailbox.parentId) ?? [];
      siblings.push(mailbox);
      childrenByParentId.set(mailbox.parentId, siblings);
      continue;
    }

    customRoots.push(mailbox);
  }

  const orderedCustom: Array<{ depth: number; mailbox: JmapMailboxObject }> = [];
  const visited = new Set<string>();

  const visit = (mailbox: JmapMailboxObject, depth: number) => {
    if (visited.has(mailbox.id)) {
      return;
    }

    visited.add(mailbox.id);
    orderedCustom.push({ depth, mailbox });

    const children = [...(childrenByParentId.get(mailbox.id) ?? [])].sort(compareMailboxSort);

    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const mailbox of [...customRoots].sort(compareMailboxSort)) {
    visit(mailbox, 0);
  }

  for (const mailbox of customMailboxes) {
    if (!visited.has(mailbox.id)) {
      visit(mailbox, 0);
    }
  }

  return {
    custom: orderedCustom,
    system,
  };
}

function resolveActiveMailbox(mailboxes: readonly JmapMailboxObject[], pathContext: MailboxPathContext) {
  if (pathContext.mailboxId) {
    const matched = mailboxes.find((mailbox) => mailbox.id === pathContext.mailboxId);
    if (matched) {
      return matched;
    }
  }

  if (pathContext.role) {
    const roleMatch = mailboxes.find((mailbox) => mailbox.role === pathContext.role);
    if (roleMatch) {
      return roleMatch;
    }
  }

  if (!pathContext.allowFallbackSelection) {
    return null;
  }

  return mailboxes.find((mailbox) => mailbox.role === 'inbox') ?? mailboxes[0] ?? null;
}

function toNavigationItem(input: { accountId: string; activeMailboxId: string | null; depth: number; mailbox: JmapMailboxObject }): MailboxNavigationItem {
  const role = isMailboxRole(input.mailbox.role) ? input.mailbox.role : null;

  return {
    accountId: input.accountId,
    depth: input.depth,
    href: buildMailboxHref(input.accountId, input.mailbox),
    id: input.mailbox.id,
    isActive: input.mailbox.id === input.activeMailboxId,
    kind: role ? 'system' : 'custom',
    name: getMailboxName(input.mailbox),
    role,
    totalCount: input.mailbox.totalThreads ?? input.mailbox.totalEmails ?? 0,
    unreadCount: input.mailbox.unreadThreads ?? input.mailbox.unreadEmails ?? 0,
  };
}

export function buildMailboxShellViewModel(input: BuildMailboxShellViewModelInput): MailboxShellViewModel {
  const account = input.session.accounts[input.accountId];
  const accounts = toMailboxAccountOptions(input.session);
  const pathContext = resolveMailboxPathContext(input.pathname, input.searchMailboxId);
  const activeMailbox = resolveActiveMailbox(input.mailboxes, pathContext);
  const activeMailboxId = activeMailbox?.id ?? null;
  const { custom, system } = partitionMailboxes(input.mailboxes);
  const systemItems = system.map((mailbox) => toNavigationItem({ accountId: input.accountId, activeMailboxId, depth: 0, mailbox }));
  const customItems = custom.map(({ depth, mailbox }) => toNavigationItem({ accountId: input.accountId, activeMailboxId, depth, mailbox }));
  const mailboxItems = [...systemItems, ...customItems];

  return {
    accounts,
    activeAccountId: account?.id ?? null,
    activeAccountLabel: getAccountLabel(account),
    activeMailboxId,
    activeMailboxName: activeMailbox ? getMailboxName(activeMailbox) : '没有可显示的邮箱',
    activeMailboxRole: isMailboxRole(activeMailbox?.role) ? activeMailbox.role : null,
    customItems,
    hasMultipleAccounts: accounts.length > 1,
    mailboxItems,
    systemItems,
    totalUnread: mailboxItems.reduce((sum, mailbox) => sum + mailbox.unreadCount, 0),
    username: input.session.username,
  };
}

export async function queryMailboxCollection(input: { readonly accountId: string; readonly client: JmapClient }): Promise<MailboxCollectionData> {
  const queryResult = await input.client.mailbox.query({
    accountId: input.accountId,
    sort: MAILBOX_QUERY_SORT,
  });

  if (!queryResult.ok) {
    throw new Error(queryResult.error.message);
  }

  if (queryResult.result.kind !== 'success') {
    throw new Error(queryResult.result.error.description ?? '邮箱列表查询失败。');
  }

  const ids = queryResult.result.response.ids;

  if (ids.length === 0) {
    return {
      accountId: input.accountId,
      ids: [],
      list: [],
      state: '',
    };
  }

  const getResult = await input.client.mailbox.get({
    accountId: input.accountId,
    ids,
    properties: MAILBOX_PROPERTIES,
  });

  if (!getResult.ok) {
    throw new Error(getResult.error.message);
  }

  if (getResult.result.kind !== 'success') {
    throw new Error(getResult.result.error.description ?? '邮箱详情读取失败。');
  }

  return {
    accountId: input.accountId,
    ids,
    list: getResult.result.response.list,
    state: getResult.result.response.state,
  };
}
