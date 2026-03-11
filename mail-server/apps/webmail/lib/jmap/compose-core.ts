import type { ReaderMessage, ReaderParticipant, ReaderThread } from '@/lib/jmap/message-reader';

export type ComposeIntent = 'forward' | 'new' | 'reply' | 'reply-all';

export interface ComposeRecipient {
  readonly email: string;
  readonly label: string;
  readonly name: string | null;
  readonly raw: string;
}

export interface ComposeFormState {
  readonly body: string;
  readonly subject: string;
  readonly to: string;
}

export type ComposeStoredAttachmentStatus = 'failed' | 'rejected' | 'uploaded';

export interface ComposeStoredAttachment {
  readonly blobId: string | null;
  readonly errorMessage: string | null;
  readonly name: string;
  readonly size: number;
  readonly status: ComposeStoredAttachmentStatus;
  readonly type: string | null;
 }

export interface ComposeQuotedContent {
  readonly body: string;
  readonly header: string;
  readonly text: string;
}

export interface ComposePrefill {
  readonly form: ComposeFormState;
  readonly quoted: ComposeQuotedContent | null;
}

export interface ComposeValidationErrors {
  readonly body: string | null;
  readonly subject: string | null;
  readonly to: string | null;
}

export type ComposeValidationResult =
  | {
      readonly errors: ComposeValidationErrors;
      readonly ok: false;
      readonly recipients: readonly ComposeRecipient[];
    }
  | {
      readonly errors: ComposeValidationErrors;
      readonly ok: true;
      readonly recipients: readonly ComposeRecipient[];
    };

export interface ComposeRouteState {
  readonly accountId: string | null;
  readonly intent: ComposeIntent;
  readonly messageId: string | null;
  readonly returnTo: string | null;
  readonly threadId: string | null;
}

export interface ComposeDraftRecord {
  readonly attachments: readonly ComposeStoredAttachment[];
  readonly accountId: string | null;
  readonly form: ComposeFormState;
  readonly identityId: string | null;
  readonly intent: ComposeIntent;
  readonly messageId: string | null;
  readonly returnTo: string | null;
  readonly threadId: string | null;
  readonly updatedAt: number;
}

const COMPOSE_ROUTE_ORIGIN = 'https://compose.local';
const EMPTY_LABEL = '未填写';
const FORWARD_HEADER = '-------- 转发邮件 --------';
const FORWARD_SUBJECT_PREFIX = '转发：';
const NEW_INTENT: ComposeIntent = 'new';
const ORIGINAL_HEADER = '-------- 原始邮件 --------';
const RECIPIENT_SPLIT_PATTERN = /[;,\n]+/;
const REPLY_SUBJECT_PREFIX = '回复：';
const SIMPLE_EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SUBJECT_PREFIX_PATTERN = /^\s*((?:re|fw|fwd)\s*:\s*|回复\s*[：:]\s*|转发\s*[：:]\s*)+/i;

export const EMPTY_COMPOSE_FORM_STATE: ComposeFormState = {
  body: '',
  subject: '',
  to: '',
};

function cleanAddressText(value: string) {
  return value.trim().replace(/^"|"$/g, '');
}

function parseRecipientToken(token: string): ComposeRecipient | null {
  const raw = token.trim();

  if (raw.length === 0) {
    return null;
  }

  const namedMatch = raw.match(/^(.*)<([^<>]+)>$/);

  if (namedMatch) {
    const email = cleanAddressText(namedMatch[2] ?? '').toLowerCase();

    if (!SIMPLE_EMAIL_PATTERN.test(email)) {
      return null;
    }

    const name = cleanAddressText(namedMatch[1] ?? '') || null;
    return {
      email,
      label: name ? `${name} <${email}>` : email,
      name,
      raw,
    };
  }

  const email = cleanAddressText(raw).toLowerCase();

  if (!SIMPLE_EMAIL_PATTERN.test(email)) {
    return null;
  }

  return {
    email,
    label: email,
    name: null,
    raw,
  };
}

function buildRecipientKey(participant: ReaderParticipant) {
  return (participant.email ?? participant.label).trim().toLowerCase();
}

function toQuotedParticipant(participant: ReaderParticipant, selfEmail: string | null) {
  const email = participant.email?.trim() ?? '';
  const name = participant.name?.trim() ?? '';

  if (email.length > 0 && selfEmail && email.toLowerCase() === selfEmail) {
    return email;
  }

  if (name.length > 0 && email.length > 0 && name.toLowerCase() !== email.toLowerCase()) {
    return `${name} <${email}>`;
  }

  if (email.length > 0) {
    return email;
  }

  return participant.label.trim() || EMPTY_LABEL;
}

function formatQuotedParticipants(participants: readonly ReaderParticipant[], selfEmail: string | null) {
  return participants.length > 0 ? participants.map((participant) => toQuotedParticipant(participant, selfEmail)).join('、') : EMPTY_LABEL;
}

function formatQuotedDateTime(value: string | null) {
  if (!value) {
    return '未知时间';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return '未知时间';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function pickReplyRecipients(message: ReaderMessage) {
  if (message.replyTo.length > 0) {
    return message.replyTo;
  }

  if (message.from.length > 0) {
    return message.from;
  }

  return message.sender;
}

function dedupeParticipants(participants: readonly ReaderParticipant[], selfEmail: string | null) {
  const selfKey = selfEmail?.trim().toLowerCase() ?? null;
  const seen = new Set<string>();

  return participants.filter((participant) => {
    const key = buildRecipientKey(participant);

    if (key.length === 0 || key === selfKey || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function serializeParticipant(participant: ReaderParticipant) {
  return parseRecipientToken(toQuotedParticipant(participant, null))?.label ?? (participant.email?.trim() || participant.label.trim());
}

function serializeRecipients(participants: readonly ReaderParticipant[]) {
  return participants.map(serializeParticipant).join(', ');
}

function normalizeSubjectBase(value: string | null | undefined) {
  const subject = value?.trim() ?? '';
  const base = subject.replace(SUBJECT_PREFIX_PATTERN, '').trim();
  return base.length > 0 ? base : '（无主题）';
}

function quotePlainText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

function toQuotedSourceText(message: ReaderMessage) {
  const plainText = message.body.plainText?.trim();

  if (plainText && plainText.length > 0) {
    return plainText;
  }

  const preview = message.preview.trim();
  return preview.length > 0 ? preview : '（原始邮件没有可引用的纯文本内容）';
}

function buildQuotedHeader(intent: ComposeIntent, message: ReaderMessage, selfEmail: string | null) {
  const lines = [
    intent === 'forward' ? FORWARD_HEADER : ORIGINAL_HEADER,
    `发件人：${formatQuotedParticipants(message.from.length > 0 ? message.from : message.sender, selfEmail)}`,
    `发送时间：${formatQuotedDateTime(message.receivedAt ?? message.sentAt)}`,
    `收件人：${formatQuotedParticipants(message.to, selfEmail)}`,
  ];

  if (message.cc.length > 0) {
    lines.push(`抄送：${formatQuotedParticipants(message.cc, selfEmail)}`);
  }

  lines.push(`主题：${normalizeSubjectBase(message.subject)}`);
  return lines.join('\n');
}

export function parseComposeIntent(value: string | null | undefined): ComposeIntent {
  return value === 'reply' || value === 'reply-all' || value === 'forward' || value === 'new' ? value : NEW_INTENT;
}

export function parseComposeRouteState(searchParams: URLSearchParams): ComposeRouteState {
  const returnTo = searchParams.get('returnTo');

  return {
    accountId: searchParams.get('accountId'),
    intent: parseComposeIntent(searchParams.get('intent')),
    messageId: searchParams.get('messageId'),
    returnTo: returnTo && returnTo.startsWith('/mail/') ? returnTo : null,
    threadId: searchParams.get('threadId'),
  };
}

export function buildComposeDraftKey(routeState: Pick<ComposeRouteState, 'accountId' | 'intent' | 'messageId' | 'threadId'>) {
  return [
    routeState.intent,
    routeState.accountId ?? 'default-account',
    routeState.threadId ?? 'standalone-thread',
    routeState.messageId ?? 'latest-message',
  ].join('::');
}

export function buildComposeRouteHref(routeState: Partial<ComposeRouteState> & Pick<ComposeRouteState, 'intent'>) {
  const url = new URL('/mail/compose', COMPOSE_ROUTE_ORIGIN);
  url.searchParams.set('intent', routeState.intent);

  if (routeState.accountId) {
    url.searchParams.set('accountId', routeState.accountId);
  }

  if (routeState.threadId) {
    url.searchParams.set('threadId', routeState.threadId);
  }

  if (routeState.messageId) {
    url.searchParams.set('messageId', routeState.messageId);
  }

  if (routeState.returnTo && routeState.returnTo.startsWith('/mail/')) {
    url.searchParams.set('returnTo', routeState.returnTo);
  }

  return `${url.pathname}${url.search}`;
}

export function areComposeFormStatesEqual(left: ComposeFormState, right: ComposeFormState) {
  return left.to === right.to && left.subject === right.subject && left.body === right.body;
}

export function hasComposeContent(form: ComposeFormState) {
  return form.to.trim().length > 0 || form.subject.trim().length > 0 || form.body.trim().length > 0;
}

export function parseComposeRecipients(value: string) {
  const recipients: ComposeRecipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const token of value.split(RECIPIENT_SPLIT_PATTERN)) {
    const trimmed = token.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const recipient = parseRecipientToken(trimmed);

    if (!recipient) {
      invalid.push(trimmed);
      continue;
    }

    if (seen.has(recipient.email)) {
      continue;
    }

    seen.add(recipient.email);
    recipients.push(recipient);
  }

  return {
    invalid,
    recipients,
  } as const;
}

export function validateComposeForm(form: ComposeFormState): ComposeValidationResult {
  const parsedRecipients = parseComposeRecipients(form.to);
  const toError = parsedRecipients.invalid.length > 0
    ? `以下地址无效：${parsedRecipients.invalid.join('，')}`
    : parsedRecipients.recipients.length === 0
      ? '至少填写一个有效收件人。'
      : null;
  const errors: ComposeValidationErrors = {
    body: null,
    subject: null,
    to: toError,
  };

  if (errors.to) {
    return {
      errors,
      ok: false,
      recipients: parsedRecipients.recipients,
    };
  }

  return {
    errors,
    ok: true,
    recipients: parsedRecipients.recipients,
  };
}

export function buildComposeQuotedContent(intent: Exclude<ComposeIntent, 'new'>, message: ReaderMessage, selfEmail: string | null = null): ComposeQuotedContent {
  const header = buildQuotedHeader(intent, message, selfEmail);
  const sourceText = toQuotedSourceText(message);

  return {
    body: intent === 'forward' ? `${header}\n\n${sourceText}` : `${header}\n${quotePlainText(sourceText)}`,
    header,
    text: sourceText,
  };
}

export function buildReplySubject(subject: string | null | undefined) {
  return `${REPLY_SUBJECT_PREFIX}${normalizeSubjectBase(subject)}`;
}

export function buildForwardSubject(subject: string | null | undefined) {
  return `${FORWARD_SUBJECT_PREFIX}${normalizeSubjectBase(subject)}`;
}

export function selectComposeSourceMessage(thread: ReaderThread, messageId: string | null) {
  if (messageId) {
    const matched = thread.messages.find((message) => message.id === messageId);

    if (matched) {
      return matched;
    }
  }

  return thread.messages[thread.messages.length - 1] ?? null;
}

export function buildComposePrefill(input: {
  readonly intent: ComposeIntent;
  readonly selfEmail: string | null;
  readonly thread: ReaderThread;
  readonly messageId: string | null;
}): ComposePrefill {
  const message = selectComposeSourceMessage(input.thread, input.messageId);

  if (!message) {
    return {
      form: EMPTY_COMPOSE_FORM_STATE,
      quoted: null,
    };
  }

  if (input.intent === 'new') {
    return {
      form: EMPTY_COMPOSE_FORM_STATE,
      quoted: null,
    };
  }

  const quoted = buildComposeQuotedContent(input.intent, message, input.selfEmail);

  if (input.intent === 'forward') {
    return {
      form: {
        body: `\n\n${quoted.body}`,
        subject: buildForwardSubject(message.subject),
        to: '',
      },
      quoted,
    };
  }

  const replyRecipients = input.intent === 'reply'
    ? dedupeParticipants(pickReplyRecipients(message), input.selfEmail)
    : dedupeParticipants([...pickReplyRecipients(message), ...message.to, ...message.cc], input.selfEmail);

  return {
    form: {
      body: `\n\n${quoted.body}`,
      subject: buildReplySubject(message.subject),
      to: serializeRecipients(replyRecipients),
    },
    quoted,
  };
}
