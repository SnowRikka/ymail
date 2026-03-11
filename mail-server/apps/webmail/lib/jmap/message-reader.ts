import { buildBlobProxyPath } from '@/lib/jmap/session';
import type { JmapClient, JmapEmailAddress, JmapEmailBodyPart, JmapEmailBodyValue, JmapEmailObject, JmapThreadObject } from '@/lib/jmap/types';

const THREAD_PROPERTIES = ['id', 'emailIds'] as const;
const EMAIL_PROPERTIES = [
  'id',
  'blobId',
  'threadId',
  'subject',
  'preview',
  'receivedAt',
  'sentAt',
  'from',
  'to',
  'cc',
  'bcc',
  'replyTo',
  'sender',
  'keywords',
  'mailboxIds',
  'hasAttachment',
  'textBody',
  'htmlBody',
  'bodyValues',
  'attachments',
] as const;
const BODY_PROPERTIES = ['partId', 'blobId', 'cid', 'disposition', 'language', 'location', 'name', 'size', 'type'] as const;

export interface ReaderParticipant {
  readonly email: string | null;
  readonly label: string;
  readonly name: string | null;
}

export interface ReaderAttachment {
  readonly blobId: string;
  readonly cid: string | null;
  readonly contentType: string | null;
  readonly disposition: string | null;
  readonly downloadUrl: string;
  readonly isInline: boolean;
  readonly name: string;
  readonly openUrl: string;
  readonly size: number | null;
}

export interface ReaderBodyContent {
  readonly html: string | null;
  readonly plainText: string | null;
}

export interface ReaderMessage {
  readonly attachments: readonly ReaderAttachment[];
  readonly bcc: readonly ReaderParticipant[];
  readonly body: ReaderBodyContent;
  readonly cc: readonly ReaderParticipant[];
  readonly from: readonly ReaderParticipant[];
  readonly id: string;
  readonly isFlagged: boolean;
  readonly isUnread: boolean;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
  readonly preview: string;
  readonly receivedAt: string | null;
  readonly replyTo: readonly ReaderParticipant[];
  readonly sentAt: string | null;
  readonly sender: readonly ReaderParticipant[];
  readonly subject: string;
  readonly threadId: string;
  readonly to: readonly ReaderParticipant[];
}

export interface ReaderThread {
  readonly accountId: string;
  readonly emailIds: readonly string[];
  readonly id: string;
  readonly isFlagged: boolean;
  readonly isUnread: boolean;
  readonly mailboxIds: Readonly<Record<string, boolean>>;
  readonly messageCount: number;
  readonly messages: readonly ReaderMessage[];
  readonly subject: string;
}

const KEYWORD_FLAGGED = '$flagged';
const KEYWORD_SEEN = '$seen';

function ensureSuccessResult<Response>(
  result: { readonly kind: 'method-error'; readonly error: { readonly description?: string } } | { readonly kind: 'success'; readonly response: Response },
  fallbackMessage: string,
): Response {
  if (result.kind !== 'success') {
    throw new Error(result.error.description ?? fallbackMessage);
  }

  return result.response;
}

function toEmailMap(emails: readonly JmapEmailObject[]) {
  return new Map(emails.map((email) => [email.id, email]));
}

function normalizeParticipant(address: JmapEmailAddress): ReaderParticipant {
  const name = typeof address.name === 'string' && address.name.trim().length > 0 ? address.name.trim() : null;
  const email = typeof address.email === 'string' && address.email.trim().length > 0 ? address.email.trim() : null;

  return {
    email,
    label: name ?? email ?? '未填写',
    name,
  };
}

function normalizeParticipants(addresses: readonly JmapEmailAddress[] | undefined): readonly ReaderParticipant[] {
  return (addresses ?? []).map(normalizeParticipant);
}

function readBodyValue(bodyValues: Readonly<Record<string, JmapEmailBodyValue>> | undefined, partId: string | undefined) {
  if (!bodyValues || !partId) {
    return null;
  }

  const entry = bodyValues[partId];
  return typeof entry?.value === 'string' && entry.value.length > 0 ? entry.value : null;
}

function collectBodyValue(parts: readonly JmapEmailBodyPart[] | undefined, bodyValues: Readonly<Record<string, JmapEmailBodyValue>> | undefined) {
  const values = (parts ?? [])
    .map((part) => readBodyValue(bodyValues, part.partId))
    .filter((value): value is string => value !== null);

  return values.length > 0 ? values.join('\n\n') : null;
}

function normalizeCid(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.replace(/^<|>$/g, '').trim() || null;
}

function toAttachment(accountId: string, part: JmapEmailBodyPart): ReaderAttachment | null {
  if (typeof part.blobId !== 'string' || part.blobId.length === 0) {
    return null;
  }

  const contentType = typeof part.type === 'string' && part.type.length > 0 ? part.type : null;
  const name = typeof part.name === 'string' && part.name.trim().length > 0 ? part.name.trim() : '未命名附件';

  return {
    blobId: part.blobId,
    cid: normalizeCid(part.cid),
    contentType,
    disposition: typeof part.disposition === 'string' ? part.disposition : null,
    downloadUrl: buildBlobProxyPath(accountId, part.blobId, { download: true, name, type: contentType }),
    isInline: part.disposition === 'inline',
    name,
    openUrl: buildBlobProxyPath(accountId, part.blobId, { name, type: contentType }),
    size: typeof part.size === 'number' && Number.isFinite(part.size) ? part.size : null,
  };
}

function compareMessageChronology(left: ReaderMessage, right: ReaderMessage) {
  const leftTime = new Date(left.receivedAt ?? left.sentAt ?? 0).getTime();
  const rightTime = new Date(right.receivedAt ?? right.sentAt ?? 0).getTime();

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
}

function toReaderMessage(accountId: string, email: JmapEmailObject): ReaderMessage {
  const attachments = (email.attachments ?? [])
    .map((part) => toAttachment(accountId, part))
    .filter((part): part is ReaderAttachment => part !== null);

  return {
    attachments,
    bcc: normalizeParticipants(email.bcc),
    body: {
      html: collectBodyValue(email.htmlBody, email.bodyValues),
      plainText: collectBodyValue(email.textBody, email.bodyValues),
    },
    cc: normalizeParticipants(email.cc),
    from: normalizeParticipants(email.from),
    id: email.id,
    isFlagged: email.keywords?.[KEYWORD_FLAGGED] === true,
    isUnread: email.keywords?.[KEYWORD_SEEN] !== true,
    mailboxIds: email.mailboxIds ?? {},
    preview: email.preview?.trim() || '暂无预览摘要',
    receivedAt: email.receivedAt ?? null,
    replyTo: normalizeParticipants(email.replyTo),
    sender: normalizeParticipants(email.sender),
    sentAt: email.sentAt ?? null,
    subject: email.subject?.trim() || '（无主题）',
    threadId: email.threadId ?? '',
    to: normalizeParticipants(email.to),
  };
}

function mergeMailboxIds(messages: readonly ReaderMessage[]) {
  return Object.fromEntries(
    messages.flatMap((message) => Object.entries(message.mailboxIds).filter(([, enabled]) => enabled === true)),
  );
}

export async function queryReaderThread(input: { accountId: string; client: JmapClient; threadId: string }): Promise<ReaderThread | null> {
  const threadResult = await input.client.thread.get({
    accountId: input.accountId,
    ids: [input.threadId],
    properties: THREAD_PROPERTIES,
  });

  if (!threadResult.ok) {
    throw new Error(threadResult.error.message);
  }

  const threadResponse = ensureSuccessResult(threadResult.result, '线程详情读取失败。');
  const thread = threadResponse.list[0] as JmapThreadObject | undefined;

  if (!thread || !Array.isArray(thread.emailIds) || thread.emailIds.length === 0) {
    return null;
  }

  const emailResult = await input.client.email.get({
    accountId: input.accountId,
    bodyProperties: BODY_PROPERTIES,
    fetchHTMLBodyValues: true,
    fetchTextBodyValues: true,
    ids: thread.emailIds,
    maxBodyValueBytes: 2_000_000,
    properties: EMAIL_PROPERTIES,
  });

  if (!emailResult.ok) {
    throw new Error(emailResult.error.message);
  }

  const emailResponse = ensureSuccessResult(emailResult.result, '邮件内容读取失败。');
  const emailMap = toEmailMap(emailResponse.list);
  const messages = thread.emailIds
    .map((emailId) => emailMap.get(emailId))
    .filter((email): email is JmapEmailObject => Boolean(email && email.threadId === input.threadId))
    .map((email) => toReaderMessage(input.accountId, email))
    .sort(compareMessageChronology);

  if (messages.length === 0) {
    return null;
  }

  return {
    accountId: input.accountId,
    emailIds: messages.map((message) => message.id),
    id: input.threadId,
    isFlagged: messages.some((message) => message.isFlagged),
    isUnread: messages.some((message) => message.isUnread),
    mailboxIds: mergeMailboxIds(messages),
    messageCount: messages.length,
    messages,
    subject: messages[messages.length - 1]?.subject ?? '（无主题）',
  };
}
