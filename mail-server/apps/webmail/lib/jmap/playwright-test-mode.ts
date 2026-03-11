import { JMAP_CAPABILITY_URNS } from '@/lib/jmap/types';
import { parseJmapSessionResource } from '@/lib/jmap/session';

type Address = {
  readonly email: string;
  readonly name?: string;
};

type Attachment = {
  readonly blobId: string;
  readonly cid?: string;
  readonly disposition: 'attachment' | 'inline';
  readonly name: string;
  readonly partId: string;
  readonly size: number;
  readonly type: string;
};

type EmailFixture = {
  readonly attachments: readonly Attachment[];
  readonly bcc: readonly Address[];
  readonly blobId: string;
  readonly bodyValues: Readonly<Record<string, { readonly value: string }>>;
  readonly cc: readonly Address[];
  readonly from: readonly Address[];
  readonly hasAttachment: boolean;
  readonly htmlBody: readonly { readonly partId: string; readonly type: string }[];
  readonly id: string;
  readonly keywords: Readonly<Record<string, boolean>>;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
  readonly preview: string;
  readonly receivedAt: string;
  readonly replyTo: readonly Address[];
  readonly sender: readonly Address[];
  readonly sentAt: string;
  readonly subject: string;
  readonly textBody: readonly { readonly partId: string; readonly type: string }[];
  readonly threadId: string;
  readonly to: readonly Address[];
};

type MailboxFixture = {
  readonly id: string;
  readonly isSubscribed: boolean;
  readonly name: string;
  readonly parentId: string | null;
  readonly role: string | null;
  readonly sortOrder: number;
  readonly totalEmails: number;
  readonly totalThreads: number;
  readonly unreadEmails: number;
  readonly unreadThreads: number;
};

type JmapCondition = {
  readonly bcc?: string;
  readonly body?: string;
  readonly cc?: string;
  readonly conditions?: readonly JmapCondition[];
  readonly from?: string;
  readonly hasAttachment?: boolean;
  readonly inMailbox?: string;
  readonly keyword?: string;
  readonly notKeyword?: string;
  readonly operator?: 'AND' | 'NOT' | 'OR';
  readonly subject?: string;
  readonly text?: string;
  readonly to?: string;
};

type JmapMethodRequest = {
  readonly accountId?: string;
  readonly create?: Readonly<Record<string, { readonly emailId?: string; readonly identityId?: string }>>;
  readonly filter?: JmapCondition;
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly position?: number;
  readonly sinceQueryState?: string;
  readonly sinceState?: string;
  readonly update?: Readonly<Record<string, unknown>>;
};

type JmapRequestPayload = {
  readonly methodCalls?: readonly [string, JmapMethodRequest, string][];
};

const ACCOUNT_ID = 'primary';
const SESSION_STATE = 'playwright-session-state';
const MAILBOX_QUERY_STATE = 'playwright-mailbox-query-state';
const MAILBOX_STATE = 'playwright-mailbox-state';
const EMAIL_QUERY_STATE = 'playwright-email-query-state';
const EMAIL_STATE = 'playwright-email-state';
const THREAD_STATE = 'playwright-thread-state';
const IDENTITY_STATE = 'playwright-identity-state';
const SUBMISSION_STATE = 'playwright-submission-state';

const MAILBOXES: readonly MailboxFixture[] = [
  {
    id: 'inbox-id',
    isSubscribed: true,
    name: 'Inbox',
    parentId: null,
    role: 'inbox',
    sortOrder: 10,
    totalEmails: 3,
    totalThreads: 2,
    unreadEmails: 2,
    unreadThreads: 1,
  },
  {
    id: 'sent-id',
    isSubscribed: true,
    name: 'Sent',
    parentId: null,
    role: 'sent',
    sortOrder: 20,
    totalEmails: 0,
    totalThreads: 0,
    unreadEmails: 0,
    unreadThreads: 0,
  },
  {
    id: 'drafts-id',
    isSubscribed: true,
    name: 'Drafts',
    parentId: null,
    role: 'drafts',
    sortOrder: 30,
    totalEmails: 0,
    totalThreads: 0,
    unreadEmails: 0,
    unreadThreads: 0,
  },
  {
    id: 'archive-id',
    isSubscribed: true,
    name: 'Archive',
    parentId: null,
    role: 'archive',
    sortOrder: 40,
    totalEmails: 0,
    totalThreads: 0,
    unreadEmails: 0,
    unreadThreads: 0,
  },
] as const;

function recipientAddress(username: string): Address {
  return {
    email: username,
    name: username.split('@')[0] || 'Playwright',
  };
}

function createEmails(username: string): readonly EmailFixture[] {
  const recipient = recipientAddress(username);

  return [
    {
      attachments: [],
      bcc: [],
      blobId: 'blob-thread-1-message-1',
      bodyValues: {
        'text-1': {
          value: 'Hi Alice,\nPlease review the latest contract revisions before Friday.\n\nRegards,\nBob',
        },
      },
      cc: [{ email: 'legal@example.com', name: 'Legal' }],
      from: [{ email: 'bob@example.com', name: 'Bob' }],
      hasAttachment: false,
      htmlBody: [],
      id: 'email-thread-1-message-1',
      keywords: { '$seen': true },
      mailboxIds: { 'inbox-id': true },
      preview: 'Please review the latest contract revisions before Friday.',
      receivedAt: '2026-03-10T09:00:00.000Z',
      replyTo: [],
      sender: [{ email: 'bob@example.com', name: 'Bob' }],
      sentAt: '2026-03-10T09:00:00.000Z',
      subject: 'Quarterly contract review',
      textBody: [{ partId: 'text-1', type: 'text/plain' }],
      threadId: 'thread-1',
      to: [recipient],
    },
    {
      attachments: [
        {
          blobId: 'blob-attachment-1',
          disposition: 'attachment',
          name: 'redlines.txt',
          partId: 'attachment-1',
          size: 1280,
          type: 'text/plain',
        },
      ],
      bcc: [],
      blobId: 'blob-thread-1-message-2',
      bodyValues: {
        'text-2': {
          value: 'Latest redlines are attached.\nPlease send feedback today if possible.\n\nThanks,\nBob',
        },
      },
      cc: [{ email: 'legal@example.com', name: 'Legal' }],
      from: [{ email: 'bob@example.com', name: 'Bob' }],
      hasAttachment: true,
      htmlBody: [],
      id: 'email-thread-1-message-2',
      keywords: {},
      mailboxIds: { 'inbox-id': true },
      preview: 'Latest redlines are attached. Please send feedback today if possible.',
      receivedAt: '2026-03-10T12:00:00.000Z',
      replyTo: [],
      sender: [{ email: 'bob@example.com', name: 'Bob' }],
      sentAt: '2026-03-10T12:00:00.000Z',
      subject: 'Quarterly contract review',
      textBody: [{ partId: 'text-2', type: 'text/plain' }],
      threadId: 'thread-1',
      to: [recipient],
    },
    {
      attachments: [],
      bcc: [],
      blobId: 'blob-thread-2-message-1',
      bodyValues: {
        'text-3': {
          value: 'The launch timeline moved to next Tuesday. No blockers on our side.',
        },
      },
      cc: [],
      from: [{ email: 'ops@example.com', name: 'Ops' }],
      hasAttachment: false,
      htmlBody: [],
      id: 'email-thread-2-message-1',
      keywords: { '$seen': true },
      mailboxIds: { 'inbox-id': true },
      preview: 'The launch timeline moved to next Tuesday.',
      receivedAt: '2026-03-09T08:30:00.000Z',
      replyTo: [],
      sender: [{ email: 'ops@example.com', name: 'Ops' }],
      sentAt: '2026-03-09T08:30:00.000Z',
      subject: 'Launch timeline update',
      textBody: [{ partId: 'text-3', type: 'text/plain' }],
      threadId: 'thread-2',
      to: [recipient],
    },
  ] as const;
}

function toThreadEmailIds(emails: readonly EmailFixture[]) {
  return new Map<string, readonly string[]>([
    ['thread-1', emails.filter((email) => email.threadId === 'thread-1').map((email) => email.id)],
    ['thread-2', emails.filter((email) => email.threadId === 'thread-2').map((email) => email.id)],
  ]);
}

function toLower(value: string) {
  return value.trim().toLowerCase();
}

function addressText(addresses: readonly Address[]) {
  return addresses.map((address) => `${address.name ?? ''} ${address.email}`.trim().toLowerCase()).join(' ');
}

function emailBodyText(email: EmailFixture) {
  return Object.values(email.bodyValues).map((entry) => entry.value.toLowerCase()).join(' ');
}

function matchesText(value: string, query: string | undefined) {
  return !query || toLower(value).includes(toLower(query));
}

function matchesCondition(email: EmailFixture, filter: JmapCondition | undefined): boolean {
  if (!filter) {
    return true;
  }

  if (Array.isArray(filter.conditions) && filter.conditions.length > 0) {
    const matches = filter.conditions.map((entry) => matchesCondition(email, entry));

    if (filter.operator === 'OR') {
      return matches.some(Boolean);
    }

    if (filter.operator === 'NOT') {
      return !matches.some(Boolean);
    }

    return matches.every(Boolean);
  }

  const inboxMatch = !filter.inMailbox || email.mailboxIds[filter.inMailbox] === true;
  const keywordMatch = !filter.keyword || email.keywords[filter.keyword] === true;
  const notKeywordMatch = !filter.notKeyword || email.keywords[filter.notKeyword] !== true;
  const attachmentMatch = filter.hasAttachment === undefined || email.hasAttachment === filter.hasAttachment;
  const fromMatch = matchesText(addressText(email.from), filter.from);
  const toMatch = matchesText(addressText(email.to), filter.to);
  const ccMatch = matchesText(addressText(email.cc), filter.cc);
  const bccMatch = matchesText(addressText(email.bcc), filter.bcc);
  const subjectMatch = matchesText(email.subject, filter.subject);
  const bodyMatch = matchesText(emailBodyText(email), filter.body);
  const textMatch = !filter.text || [email.subject, email.preview, addressText(email.from), addressText(email.to), addressText(email.cc), addressText(email.bcc), emailBodyText(email)].join(' ').includes(toLower(filter.text));

  return inboxMatch && keywordMatch && notKeywordMatch && attachmentMatch && fromMatch && toMatch && ccMatch && bccMatch && subjectMatch && bodyMatch && textMatch;
}

function sortEmails(ids: readonly string[], emails: readonly EmailFixture[]) {
  return [...ids].sort((leftId, rightId) => {
    const left = emails.find((email) => email.id === leftId);
    const right = emails.find((email) => email.id === rightId);

    if (!left || !right) {
      return leftId.localeCompare(rightId);
    }

    return right.receivedAt.localeCompare(left.receivedAt);
  });
}

function queryEmailIds(emails: readonly EmailFixture[], filter: JmapCondition | undefined) {
  return sortEmails(
    emails.filter((email) => matchesCondition(email, filter)).map((email) => email.id),
    emails,
  );
}

function safeParsePayload(body: string): JmapRequestPayload {
  if (body.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(body) as JmapRequestPayload;
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function createSessionPayload(username: string) {
  return {
    accounts: {
      [ACCOUNT_ID]: {
        accountCapabilities: {
          [JMAP_CAPABILITY_URNS.blob]: {
            maxDataSources: 4,
            maxSizeBlobSet: 1000000,
            supportedDigestAlgorithms: ['sha-256'],
            supportedTypeNames: ['Email'],
          },
          [JMAP_CAPABILITY_URNS.mail]: {
            emailQuerySortOptions: ['receivedAt'],
            maxMailboxDepth: 10,
            maxMailboxesPerEmail: null,
            maxSizeAttachmentsPerEmail: 5000000,
            maxSizeMailboxName: 255,
            mayCreateTopLevelMailbox: true,
          },
          [JMAP_CAPABILITY_URNS.submission]: {
            maxDelayedSend: 0,
            submissionExtensions: {},
          },
        },
        isPersonal: true,
        isReadOnly: false,
        name: 'Primary account',
      },
    },
    apiUrl: 'https://mail.example.test/jmap',
    capabilities: {
      [JMAP_CAPABILITY_URNS.blob]: {
        maxDataSources: 4,
        maxSizeBlobSet: 1000000,
        supportedDigestAlgorithms: ['sha-256'],
        supportedTypeNames: ['Email'],
      },
      [JMAP_CAPABILITY_URNS.core]: {
        collationAlgorithms: ['i;unicode-casemap'],
        maxCallsInRequest: 16,
        maxConcurrentRequests: 4,
        maxConcurrentUpload: 4,
        maxObjectsInGet: 256,
        maxObjectsInSet: 128,
        maxSizeRequest: 1000000,
        maxSizeUpload: 5000000,
      },
      [JMAP_CAPABILITY_URNS.mail]: {
        emailQuerySortOptions: ['receivedAt'],
        maxMailboxDepth: 10,
        maxMailboxesPerEmail: null,
        maxSizeAttachmentsPerEmail: 5000000,
        maxSizeMailboxName: 255,
        mayCreateTopLevelMailbox: true,
      },
      [JMAP_CAPABILITY_URNS.submission]: {
        maxDelayedSend: 0,
        submissionExtensions: {},
      },
      [JMAP_CAPABILITY_URNS.websocket]: {
        supportsPush: false,
        url: 'wss://mail.example.test/events',
      },
    },
    downloadUrl: 'https://mail.example.test/download/{accountId}/{blobId}/{name}?type={type}',
    eventSourceUrl: 'https://mail.example.test/events',
    primaryAccounts: {
      [JMAP_CAPABILITY_URNS.blob]: ACCOUNT_ID,
      [JMAP_CAPABILITY_URNS.mail]: ACCOUNT_ID,
      [JMAP_CAPABILITY_URNS.submission]: ACCOUNT_ID,
    },
    state: SESSION_STATE,
    uploadUrl: 'https://mail.example.test/upload/{accountId}',
    username,
  };
}

function methodResponse(name: string, request: JmapMethodRequest, username: string) {
  const emails = createEmails(username);
  const threadEmailIds = toThreadEmailIds(emails);

  if (name === 'Mailbox/query') {
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      canCalculateChanges: true,
      ids: MAILBOXES.map((mailbox) => mailbox.id),
      position: 0,
      queryState: MAILBOX_QUERY_STATE,
    };
  }

  if (name === 'Mailbox/get') {
    const ids = request.ids ?? MAILBOXES.map((mailbox) => mailbox.id);
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      list: MAILBOXES.filter((mailbox) => ids.includes(mailbox.id)),
      state: MAILBOX_STATE,
    };
  }

  if (name === 'Mailbox/changes') {
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      created: [],
      destroyed: [],
      hasMoreChanges: false,
      newState: MAILBOX_STATE,
      oldState: request.sinceState ?? MAILBOX_STATE,
      updated: [],
    };
  }

  if (name === 'Email/query') {
    const matchingIds = queryEmailIds(emails, request.filter);
    const position = request.position ?? 0;
    const limit = request.limit ?? matchingIds.length;

    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      canCalculateChanges: true,
      ids: matchingIds.slice(position, position + limit),
      position,
      queryState: EMAIL_QUERY_STATE,
    };
  }

  if (name === 'Email/queryChanges') {
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      added: [],
      newQueryState: EMAIL_QUERY_STATE,
      oldQueryState: request.sinceQueryState ?? EMAIL_QUERY_STATE,
      removed: [],
      total: queryEmailIds(emails, request.filter).length,
    };
  }

  if (name === 'Email/get') {
    const ids = request.ids ?? emails.map((email) => email.id);
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      list: emails.filter((email) => ids.includes(email.id)),
      state: EMAIL_STATE,
    };
  }

  if (name === 'Thread/get') {
    const ids = request.ids ?? [...threadEmailIds.keys()];
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      list: ids.map((id) => ({ emailIds: threadEmailIds.get(id) ?? [], id })),
      state: THREAD_STATE,
    };
  }

  if (name === 'Thread/changes') {
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      created: [],
      destroyed: [],
      hasMoreChanges: false,
      newState: THREAD_STATE,
      oldState: request.sinceState ?? THREAD_STATE,
      updated: [],
    };
  }

  if (name === 'Identity/get') {
    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      list: [
        {
          bcc: [],
          email: username,
          id: 'identity-1',
          name: recipientAddress(username).name ?? username,
          replyTo: [],
          textSignature: recipientAddress(username).name ?? username,
        },
      ],
      state: IDENTITY_STATE,
    };
  }

  if (name === 'Email/set') {
    const created = Object.fromEntries(
      Object.keys(request.create ?? {}).map((key) => [key, { id: `email-created-${key}` }]),
    );
    const updated = Object.fromEntries(
      Object.keys(request.update ?? {}).map((key) => [key, null]),
    );

    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      created,
      newState: EMAIL_STATE,
      notCreated: {},
      notUpdated: {},
      oldState: EMAIL_STATE,
      updated,
    };
  }

  if (name === 'EmailSubmission/set') {
    const created = Object.fromEntries(
      Object.entries(request.create ?? {}).map(([key, value]) => [key, { emailId: value.emailId, id: `submission-${key}` }]),
    );

    return {
      accountId: request.accountId ?? ACCOUNT_ID,
      created,
      newState: SUBMISSION_STATE,
      notCreated: {},
      oldState: SUBMISSION_STATE,
    };
  }

  return null;
}

export function isPlaywrightTestEnabled() {
  return process.env.PLAYWRIGHT_TEST === '1';
}

export function isPlaywrightTestSession(session: { readonly testMode?: boolean } | null | undefined) {
  return isPlaywrightTestEnabled() && session?.testMode === true;
}

export function createPlaywrightTestJmapSession(username: string) {
  const session = parseJmapSessionResource(createSessionPayload(username));

  if (!session) {
    throw new Error('Failed to build Playwright test JMAP session.');
  }

  return session;
}

export function createPlaywrightTestJmapResponse(input: { readonly body: string; readonly username: string }) {
  const payload = safeParsePayload(input.body);
  const methodCalls = Array.isArray(payload.methodCalls) ? payload.methodCalls : [];
  const methodResponses = methodCalls.map(([name, request, callId]) => {
    const response = methodResponse(name, request, input.username);

    if (!response) {
      return ['error', { description: `Unsupported test-mode JMAP method: ${name}`, type: 'serverFail' }, callId] as const;
    }

    return [name, response, callId] as const;
  });

  return {
    createdIds: {},
    methodResponses,
    sessionState: SESSION_STATE,
  };
}
