import type { Page, Route } from '@playwright/test';

const JMAP_URN_BLOB = 'urn:ietf:params:jmap:blob';
const JMAP_URN_CORE = 'urn:ietf:params:jmap:core';
const JMAP_URN_MAIL = 'urn:ietf:params:jmap:mail';
const JMAP_URN_SUBMISSION = 'urn:ietf:params:jmap:submission';
const JMAP_URN_WEBSOCKET = 'urn:ietf:params:jmap:websocket';

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

type IdentityFixture = {
  readonly bcc: readonly Address[];
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly replyTo: readonly Address[];
  readonly textSignature: string;
};

type JmapCondition = {
  readonly bcc?: string;
  readonly cc?: string;
  readonly conditions?: readonly JmapCondition[];
  readonly from?: string;
  readonly hasAttachment?: boolean;
  readonly inMailbox?: string;
  readonly keyword?: string;
  readonly notKeyword?: string;
  readonly operator?: 'AND' | 'OR';
  readonly subject?: string;
  readonly text?: string;
  readonly to?: string;
};

type JmapMethodRequest = {
  readonly accountId?: string;
  readonly filter?: JmapCondition;
  readonly ids?: readonly string[];
  readonly limit?: number;
  readonly position?: number;
};

type JmapRequestPayload = {
  readonly methodCalls: readonly [string, JmapMethodRequest, string][];
};

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

const EMAILS: readonly EmailFixture[] = [
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
    to: [{ email: 'alice@example.com', name: 'Alice' }],
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
    to: [{ email: 'alice@example.com', name: 'Alice' }],
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
    to: [{ email: 'alice@example.com', name: 'Alice' }],
  },
] as const;

const IDENTITIES: readonly IdentityFixture[] = [
  {
    bcc: [],
    email: 'alice@example.com',
    id: 'identity-1',
    name: 'Alice',
    replyTo: [],
    textSignature: 'Alice',
  },
] as const;

const THREAD_EMAIL_IDS = new Map<string, readonly string[]>([
  ['thread-1', ['email-thread-1-message-1', 'email-thread-1-message-2']],
  ['thread-2', ['email-thread-2-message-1']],
]);

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
    return filter.operator === 'OR' ? matches.some(Boolean) : matches.every(Boolean);
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
  const textMatch = !filter.text || [email.subject, email.preview, addressText(email.from), addressText(email.to), addressText(email.cc), addressText(email.bcc), emailBodyText(email)].join(' ').includes(toLower(filter.text));

  return inboxMatch && keywordMatch && notKeywordMatch && attachmentMatch && fromMatch && toMatch && ccMatch && bccMatch && subjectMatch && textMatch;
}

function sortEmails(ids: readonly string[]) {
  return [...ids].sort((leftId, rightId) => {
    const left = EMAILS.find((email) => email.id === leftId);
    const right = EMAILS.find((email) => email.id === rightId);

    if (!left || !right) {
      return leftId.localeCompare(rightId);
    }

    return right.receivedAt.localeCompare(left.receivedAt);
  });
}

function queryEmailIds(filter: JmapCondition | undefined) {
  return sortEmails(
    EMAILS.filter((email) => matchesCondition(email, filter)).map((email) => email.id),
  );
}

function createSessionPayload() {
  return {
    accounts: {
      primary: {
        accountCapabilities: {
          [JMAP_URN_BLOB]: {
            maxDataSources: 4,
            maxSizeBlobSet: 1000000,
            supportedDigestAlgorithms: ['sha-256'],
            supportedTypeNames: ['Email'],
          },
          [JMAP_URN_MAIL]: {
            emailQuerySortOptions: ['receivedAt'],
            maxMailboxDepth: 10,
            maxMailboxesPerEmail: null,
            maxSizeAttachmentsPerEmail: 5000000,
            maxSizeMailboxName: 255,
            mayCreateTopLevelMailbox: true,
          },
          [JMAP_URN_SUBMISSION]: {
            maxDelayedSend: 0,
            submissionExtensions: {},
          },
        },
        id: 'primary',
        isPersonal: true,
        isReadOnly: false,
        name: 'Primary account',
      },
    },
    apiUrl: 'https://mail.example.test/jmap',
    capabilities: {
      [JMAP_URN_BLOB]: {
        maxDataSources: 4,
        maxSizeBlobSet: 1000000,
        supportedDigestAlgorithms: ['sha-256'],
        supportedTypeNames: ['Email'],
      },
      [JMAP_URN_CORE]: {
        collationAlgorithms: ['i;unicode-casemap'],
        maxCallsInRequest: 16,
        maxConcurrentRequests: 4,
        maxConcurrentUpload: 4,
        maxObjectsInGet: 256,
        maxObjectsInSet: 128,
        maxSizeRequest: 1000000,
        maxSizeUpload: 5000000,
      },
      [JMAP_URN_MAIL]: {
        emailQuerySortOptions: ['receivedAt'],
        maxMailboxDepth: 10,
        maxMailboxesPerEmail: null,
        maxSizeAttachmentsPerEmail: 5000000,
        maxSizeMailboxName: 255,
        mayCreateTopLevelMailbox: true,
      },
      [JMAP_URN_SUBMISSION]: {
        maxDelayedSend: 0,
        submissionExtensions: {},
      },
      [JMAP_URN_WEBSOCKET]: {
        supportsPush: false,
        url: 'wss://mail.example.test/events',
      },
    },
    downloadUrl: 'https://mail.example.test/download/{accountId}/{blobId}/{name}?type={type}',
    eventSourceUrl: 'https://mail.example.test/events',
    primaryAccounts: {
      [JMAP_URN_BLOB]: 'primary',
      [JMAP_URN_MAIL]: 'primary',
      [JMAP_URN_SUBMISSION]: 'primary',
    },
    state: 'mock-session-state',
    uploadUrl: 'https://mail.example.test/upload/{accountId}',
    username: 'alice@example.com',
  };
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    contentType: 'application/json',
    json: payload,
    status: 200,
  });
}

function methodResponse(name: string, request: JmapMethodRequest) {
  if (name === 'Mailbox/query') {
    return {
      accountId: request.accountId ?? 'primary',
      canCalculateChanges: true,
      ids: MAILBOXES.map((mailbox) => mailbox.id),
      position: 0,
      queryState: 'mock-mailbox-query-state',
    };
  }

  if (name === 'Mailbox/get') {
    const ids = request.ids ?? MAILBOXES.map((mailbox) => mailbox.id);
    return {
      accountId: request.accountId ?? 'primary',
      list: MAILBOXES.filter((mailbox) => ids.includes(mailbox.id)),
      state: 'mock-mailbox-state',
    };
  }

  if (name === 'Email/query') {
    const matchingIds = queryEmailIds(request.filter);
    const position = request.position ?? 0;
    const limit = request.limit ?? matchingIds.length;

    return {
      accountId: request.accountId ?? 'primary',
      canCalculateChanges: true,
      ids: matchingIds.slice(position, position + limit),
      position,
      queryState: 'mock-email-query-state',
    };
  }

  if (name === 'Email/get') {
    const ids = request.ids ?? EMAILS.map((email) => email.id);
    return {
      accountId: request.accountId ?? 'primary',
      list: EMAILS.filter((email) => ids.includes(email.id)),
      state: 'mock-email-state',
    };
  }

  if (name === 'Thread/get') {
    const ids = request.ids ?? [...THREAD_EMAIL_IDS.keys()];
    return {
      accountId: request.accountId ?? 'primary',
      list: ids.map((id) => ({ emailIds: THREAD_EMAIL_IDS.get(id) ?? [], id })),
      state: 'mock-thread-state',
    };
  }

  if (name === 'Identity/get') {
    return {
      accountId: request.accountId ?? 'primary',
      list: IDENTITIES,
      state: 'mock-identity-state',
    };
  }

  if (name === 'Email/set') {
    return {
      accountId: request.accountId ?? 'primary',
      created: {},
      notCreated: {},
      oldState: 'mock-email-state',
      newState: 'mock-email-state',
    };
  }

  if (name === 'EmailSubmission/set') {
    return {
      accountId: request.accountId ?? 'primary',
      created: {},
      notCreated: {},
      oldState: 'mock-submission-state',
      newState: 'mock-submission-state',
    };
  }

  return null;
}

export async function installMockJmapApi(page: Page) {
  await page.route('**/api/jmap/session', async (route) => {
    await fulfillJson(route, createSessionPayload());
  });

  await page.route('**/api/jmap', async (route) => {
    const rawBody = route.request().postData();
    const payload = rawBody ? (JSON.parse(rawBody) as JmapRequestPayload) : { methodCalls: [] };
    const methodResponses = payload.methodCalls.map(([name, request, callId]) => {
      const response = methodResponse(name, request);

      if (!response) {
        return ['error', { description: `Unsupported mock method: ${name}`, type: 'serverFail' }, callId] as const;
      }

      return [name, response, callId] as const;
    });

    await fulfillJson(route, {
      createdIds: {},
      methodResponses,
      sessionState: 'mock-session-state',
    });
  });
}
