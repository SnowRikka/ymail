import { parseComposeRecipients, type ComposeFormState, type ComposeRecipient, type ComposeStoredAttachment } from '@/lib/jmap/compose-core';
import { createMethodCall, isJmapMethodResult } from '@/lib/jmap/methods';
import { buildBlobDownloadUrl } from '@/lib/jmap/session';
import type { JmapClient, JmapEmailAddress, JmapEmailCreateObject, JmapEmailSubmissionSetRequest, JmapExecutionError, JmapIdentityObject, JmapMailboxObject, JmapMethodFailure, JmapSetInvocationError } from '@/lib/jmap/types';

export interface ComposeIdentityOption {
  readonly bcc: readonly JmapEmailAddress[];
  readonly email: string;
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly replyTo: readonly JmapEmailAddress[];
  readonly textSignature: string | null;
}

export type ComposeIdentityState =
  | { readonly kind: 'loading' }
  | { readonly identities: readonly ComposeIdentityOption[]; readonly kind: 'ready'; readonly selectedIdentityId: string | null }
  | { readonly kind: 'error'; readonly message: string };

export type ComposeDraftStatus =
  | { readonly kind: 'idle'; readonly message: string }
  | { readonly kind: 'saving'; readonly message: string }
  | { readonly kind: 'saved'; readonly message: string; readonly savedAt: number }
  | { readonly kind: 'error'; readonly message: string };

export type ComposeUploadState = 'failed' | 'queued' | 'rejected' | 'uploaded' | 'uploading';

export interface ComposeAttachmentRecord {
  readonly blobId: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  readonly size: number;
  readonly state: ComposeUploadState;
  readonly type: string | null;
}

export interface ComposeMailboxRoleState {
  readonly draftsId: string | null;
  readonly fallbackId: string | null;
  readonly sentId: string | null;
}

export type ComposeSubmissionFailure =
  | { readonly kind: 'attachment-rejected'; readonly message: string }
  | { readonly kind: 'auth-expired'; readonly message: string }
  | { readonly kind: 'network-failure'; readonly message: string }
  | { readonly kind: 'upstream-validation'; readonly message: string };

export type ComposeSubmissionResult =
  | { readonly emailId: string; readonly kind: 'success'; readonly submissionId: string | null }
  | { readonly failure: ComposeSubmissionFailure; readonly kind: 'failure' };

export type ComposeDraftPersistenceResult =
  | { readonly draftEmailId: string; readonly kind: 'success' }
  | { readonly failure: ComposeSubmissionFailure; readonly kind: 'failure' };

export type ComposeDraftDeletionResult =
  | { readonly kind: 'success' }
  | { readonly failure: ComposeSubmissionFailure; readonly kind: 'failure' };

export interface ComposeUploadResponse {
  readonly accountId: string;
  readonly blobId: string;
  readonly size: number;
  readonly type: string;
}

interface UploadFactory {
  new(): XMLHttpRequest;
}

function normalizeAddress(address: JmapEmailAddress): JmapEmailAddress | null {
  const email = typeof address.email === 'string' ? address.email.trim() : '';

  if (email.length === 0) {
    return null;
  }

  const name = typeof address.name === 'string' ? address.name.trim() : '';
  return name.length > 0 ? { email, name } : { email };
}

function toJmapAddress(recipient: ComposeRecipient): JmapEmailAddress {
  return recipient.name ? { email: recipient.email, name: recipient.name } : { email: recipient.email };
}

function normalizeAddressList(addresses: readonly JmapEmailAddress[] | undefined): readonly JmapEmailAddress[] {
  return (addresses ?? []).map(normalizeAddress).filter((entry): entry is JmapEmailAddress => entry !== null);
}

function readInvocationError(error: JmapSetInvocationError | undefined, fallback: string): ComposeSubmissionFailure {
  const message = typeof error?.description === 'string' && error.description.length > 0 ? error.description : fallback;
  return { kind: 'upstream-validation', message };
}

export function toComposeIdentityOptions(identities: readonly JmapIdentityObject[]): readonly ComposeIdentityOption[] {
  const options: ComposeIdentityOption[] = [];

  for (const identity of identities) {
      const email = typeof identity.email === 'string' ? identity.email.trim() : '';

      if (email.length === 0) {
        continue;
      }

      const name = typeof identity.name === 'string' && identity.name.trim().length > 0 ? identity.name.trim() : email;
      options.push({
        bcc: normalizeAddressList(identity.bcc),
        email,
        id: identity.id,
        label: `${name} <${email}>`,
        name,
        replyTo: normalizeAddressList(identity.replyTo),
        textSignature: typeof identity.textSignature === 'string' && identity.textSignature.trim().length > 0 ? identity.textSignature.trim() : null,
      });
  }

  return options.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}

export function selectDefaultIdentityId(identities: readonly ComposeIdentityOption[], preferredIdentityId: string | null, username: string | null) {
  if (preferredIdentityId && identities.some((identity) => identity.id === preferredIdentityId)) {
    return preferredIdentityId;
  }

  const normalizedUser = username?.trim().toLowerCase() ?? null;
  return identities.find((identity) => identity.email.toLowerCase() === normalizedUser)?.id ?? identities[0]?.id ?? null;
}

export function toComposeMailboxRoleState(mailboxes: readonly JmapMailboxObject[]): ComposeMailboxRoleState {
  return {
    draftsId: mailboxes.find((mailbox) => mailbox.role === 'drafts')?.id ?? null,
    fallbackId: mailboxes.find((mailbox) => mailbox.role === 'drafts' || mailbox.role === 'sent' || mailbox.role === 'inbox')?.id ?? mailboxes[0]?.id ?? null,
    sentId: mailboxes.find((mailbox) => mailbox.role === 'sent')?.id ?? null,
  };
}

export function toStoredAttachments(attachments: readonly ComposeAttachmentRecord[]): readonly ComposeStoredAttachment[] {
  return attachments
    .filter((attachment) => attachment.state === 'uploaded' && attachment.blobId)
    .map((attachment) => ({
      blobId: attachment.blobId,
      errorMessage: null,
      name: attachment.name,
      size: attachment.size,
      status: 'uploaded',
      type: attachment.type,
    }));
}

export function fromStoredAttachments(attachments: readonly ComposeStoredAttachment[]): readonly ComposeAttachmentRecord[] {
  return attachments.map((attachment, index) => ({
    blobId: attachment.blobId,
    errorMessage: attachment.errorMessage,
    id: `draft-attachment-${index}-${attachment.blobId ?? attachment.name}`,
    name: attachment.name,
    progress: attachment.status === 'uploaded' ? 100 : 0,
    size: attachment.size,
    state: attachment.status,
    type: attachment.type,
  }));
}

export function hasPendingAttachment(attachments: readonly ComposeAttachmentRecord[]) {
  return attachments.some((attachment) => attachment.state === 'queued' || attachment.state === 'uploading');
}

export function findAttachmentFailure(attachments: readonly ComposeAttachmentRecord[]): ComposeSubmissionFailure | null {
  const rejected = attachments.find((attachment) => attachment.state === 'rejected' || attachment.state === 'failed');
  return rejected ? { kind: 'attachment-rejected', message: rejected.errorMessage ?? `附件 ${rejected.name} 未能就绪，请重新上传。` } : null;
}

export function createDraftStatus(kind: ComposeDraftStatus['kind'], message?: string): ComposeDraftStatus {
  switch (kind) {
    case 'saving':
      return { kind, message: message ?? '草稿保存中…' };
    case 'saved':
      return { kind, message: message ?? '草稿已保存。', savedAt: Date.now() };
    case 'error':
      return { kind, message: message ?? '草稿保存失败。' };
    default:
      return { kind: 'idle', message: message ?? '等待修改' };
  }
}

export function classifyComposeExecutionError(error: JmapExecutionError, fallbackMessage: string): ComposeSubmissionFailure {
  if (error.kind === 'unauthenticated') {
    return { kind: 'auth-expired', message: error.message };
  }

  if (error.kind === 'transport') {
    if (error.status === 401 || error.status === 403) {
      return { kind: 'auth-expired', message: '登录状态已失效，请重新登录。' };
    }

    if (error.status === 413 || error.status === 415 || error.status === 422) {
      return { kind: 'attachment-rejected', message: error.message };
    }

    return { kind: 'network-failure', message: error.message || fallbackMessage };
  }

  return { kind: 'upstream-validation', message: error.message || fallbackMessage };
}

export function classifyComposeMethodFailure(failure: JmapMethodFailure, fallbackMessage: string): ComposeSubmissionFailure {
  const message = typeof failure.error.description === 'string' && failure.error.description.length > 0 ? failure.error.description : fallbackMessage;
  return failure.error.type === 'forbidden'
    ? { kind: 'auth-expired', message }
    : { kind: 'upstream-validation', message };
}

export function buildComposeSubmissionRequest(input: {
  readonly attachments: readonly ComposeAttachmentRecord[];
  readonly form: ComposeFormState;
  readonly identity: ComposeIdentityOption;
  readonly mailboxRoleState: ComposeMailboxRoleState;
}) {
  const parsedRecipients = parseComposeRecipients(input.form.to);
  const to = parsedRecipients.recipients.map(toJmapAddress);
  const mailboxId = input.mailboxRoleState.draftsId ?? input.mailboxRoleState.sentId ?? input.mailboxRoleState.fallbackId;

  if (!mailboxId) {
    return {
      failure: { kind: 'upstream-validation', message: '当前账号缺少可写邮箱，无法创建待发送邮件。' } satisfies ComposeSubmissionFailure,
      ok: false as const,
    };
  }

  const textBody = input.identity.textSignature && !input.form.body.includes(input.identity.textSignature)
    ? `${input.form.body}\n\n-- \n${input.identity.textSignature}`
    : input.form.body;
  const create: JmapEmailCreateObject = {
    bcc: input.identity.bcc,
    from: [{ email: input.identity.email, name: input.identity.name }],
    keywords: input.mailboxRoleState.draftsId ? { '$draft': true } : undefined,
    mailboxIds: { [mailboxId]: true },
    replyTo: input.identity.replyTo.length > 0 ? input.identity.replyTo : undefined,
    subject: input.form.subject,
    textBody: [{ partId: 'text-part', type: 'text/plain' }],
    to,
    bodyValues: {
      'text-part': {
        value: textBody,
      },
    },
    attachments: input.attachments
      .filter((attachment) => attachment.blobId)
      .map((attachment) => ({
        blobId: attachment.blobId ?? undefined,
        disposition: 'attachment',
        name: attachment.name,
        size: attachment.size,
        type: attachment.type ?? 'application/octet-stream',
      })),
  };

  const onSuccessUpdateEmail = input.mailboxRoleState.sentId
    ? {
        [`mailboxIds/${input.mailboxRoleState.sentId}`]: true,
        ...(input.mailboxRoleState.draftsId ? { [`mailboxIds/${input.mailboxRoleState.draftsId}`]: null } : {}),
        ...(input.mailboxRoleState.draftsId ? { 'keywords/$draft': null } : {}),
      }
    : input.mailboxRoleState.draftsId
      ? { 'keywords/$draft': null }
      : undefined;

  const submission: Omit<JmapEmailSubmissionSetRequest, 'accountId'> = {
    create: {
      'send-submission': {
        emailId: '#send-email',
        identityId: input.identity.id,
      },
    },
    onSuccessUpdateEmail: onSuccessUpdateEmail ? { '#send-submission': onSuccessUpdateEmail } : undefined,
  };

  return {
    emailCreate: create,
    ok: true as const,
    submission,
  };
}

function buildDraftEmailObject(input: {
  readonly attachments: readonly ComposeAttachmentRecord[];
  readonly form: ComposeFormState;
  readonly identity: ComposeIdentityOption | null;
  readonly mailboxRoleState: ComposeMailboxRoleState;
}) {
  const draftsMailboxId = input.mailboxRoleState.draftsId;

  if (!draftsMailboxId) {
    return {
      failure: { kind: 'upstream-validation', message: '当前账号缺少 Drafts 邮箱，无法保存草稿。' } satisfies ComposeSubmissionFailure,
      ok: false as const,
    };
  }

  const parsedRecipients = parseComposeRecipients(input.form.to);
  const textBody = input.identity?.textSignature && !input.form.body.includes(input.identity.textSignature)
    ? `${input.form.body}\n\n-- \n${input.identity.textSignature}`
    : input.form.body;
  const email = {
    attachments: input.attachments
      .filter((attachment) => attachment.blobId)
      .map((attachment) => ({
        blobId: attachment.blobId ?? undefined,
        disposition: 'attachment',
        name: attachment.name,
        size: attachment.size,
        type: attachment.type ?? 'application/octet-stream',
      })),
    bcc: input.identity && input.identity.bcc.length > 0 ? input.identity.bcc : undefined,
    bodyValues: {
      'text-part': {
        value: textBody,
      },
    },
    from: input.identity ? [{ email: input.identity.email, name: input.identity.name }] : undefined,
    keywords: { '$draft': true },
    mailboxIds: { [draftsMailboxId]: true },
    replyTo: input.identity && input.identity.replyTo.length > 0 ? input.identity.replyTo : undefined,
    subject: input.form.subject,
    textBody: [{ partId: 'text-part', type: 'text/plain' }],
    to: parsedRecipients.recipients.map(toJmapAddress),
  } satisfies JmapEmailCreateObject;

  return {
    email,
    ok: true as const,
  };
}

export async function persistComposeDraft(input: {
  readonly accountId: string;
  readonly attachments: readonly ComposeAttachmentRecord[];
  readonly client: JmapClient;
  readonly draftEmailId?: string | null;
  readonly form: ComposeFormState;
  readonly identity: ComposeIdentityOption | null;
  readonly mailboxRoleState: ComposeMailboxRoleState;
}): Promise<ComposeDraftPersistenceResult> {
  const prepared = buildDraftEmailObject(input);

  if (!prepared.ok) {
    return { failure: prepared.failure, kind: 'failure' };
  }

  const result = await input.client.email.set({
    accountId: input.accountId,
    create: input.draftEmailId ? undefined : { 'draft-email': prepared.email },
    update: input.draftEmailId ? { [input.draftEmailId]: prepared.email } : undefined,
  });

  if (!result.ok) {
    return { failure: classifyComposeExecutionError(result.error, '草稿保存失败。'), kind: 'failure' };
  }

  if (result.result.kind !== 'success') {
    return { failure: classifyComposeMethodFailure(result.result, '草稿保存失败。'), kind: 'failure' };
  }

  if (!input.draftEmailId) {
    const createdDraft = result.result.response.created?.['draft-email'];
    const createError = result.result.response.notCreated?.['draft-email'];

    if (!createdDraft?.id) {
      return { failure: readInvocationError(createError, '草稿创建失败。'), kind: 'failure' };
    }

    return { draftEmailId: createdDraft.id, kind: 'success' };
  }

  if (result.result.response.notUpdated?.[input.draftEmailId]) {
    return { failure: readInvocationError(result.result.response.notUpdated[input.draftEmailId], '草稿更新失败。'), kind: 'failure' };
  }

  return { draftEmailId: input.draftEmailId, kind: 'success' };
}

export async function destroyComposeDraft(input: {
  readonly accountId: string;
  readonly client: JmapClient;
  readonly draftEmailId: string;
}): Promise<ComposeDraftDeletionResult> {
  const result = await input.client.email.set({
    accountId: input.accountId,
    destroy: [input.draftEmailId],
  });

  if (!result.ok) {
    return { failure: classifyComposeExecutionError(result.error, '草稿删除失败。'), kind: 'failure' };
  }

  if (result.result.kind !== 'success') {
    return { failure: classifyComposeMethodFailure(result.result, '草稿删除失败。'), kind: 'failure' };
  }

  if (result.result.response.notDestroyed?.[input.draftEmailId]) {
    return { failure: readInvocationError(result.result.response.notDestroyed[input.draftEmailId], '草稿删除失败。'), kind: 'failure' };
  }

  return { kind: 'success' };
}

export async function submitComposeMessage(input: {
  readonly accountId: string;
  readonly attachments: readonly ComposeAttachmentRecord[];
  readonly client: JmapClient;
  readonly form: ComposeFormState;
  readonly identity: ComposeIdentityOption;
  readonly mailboxRoleState: ComposeMailboxRoleState;
}): Promise<ComposeSubmissionResult> {
  const prepared = buildComposeSubmissionRequest(input);

  if (!prepared.ok) {
    return { failure: prepared.failure, kind: 'failure' };
  }

  const batchResult = await input.client.call([
    createMethodCall('Email/set', {
      accountId: input.accountId,
      create: {
        'send-email': prepared.emailCreate,
      },
    }, 'send-email'),
    createMethodCall('EmailSubmission/set', {
      accountId: input.accountId,
      ...prepared.submission,
    }, 'send-submission'),
  ]);

  if (!batchResult.ok) {
    return { failure: classifyComposeExecutionError(batchResult.error, '邮件发送失败。'), kind: 'failure' };
  }

  const emailMethodResult = batchResult.responses.find((response) => response.callId === 'send-email');

  if (!emailMethodResult || !isJmapMethodResult(emailMethodResult, 'Email/set')) {
    return { failure: { kind: 'network-failure', message: '邮件创建响应缺失。' }, kind: 'failure' };
  }

  if (emailMethodResult.kind !== 'success') {
    return { failure: classifyComposeMethodFailure(emailMethodResult, '邮件创建失败。'), kind: 'failure' };
  }

  const createdEmail = emailMethodResult.response.created?.['send-email'];
  const emailCreateError = emailMethodResult.response.notCreated?.['send-email'];

  if (!createdEmail?.id) {
    return { failure: readInvocationError(emailCreateError, '邮件创建失败。'), kind: 'failure' };
  }

  const submissionMethodResult = batchResult.responses.find((response) => response.callId === 'send-submission');

  if (!submissionMethodResult || !isJmapMethodResult(submissionMethodResult, 'EmailSubmission/set')) {
    return { failure: { kind: 'network-failure', message: '邮件提交响应缺失。' }, kind: 'failure' };
  }

  if (submissionMethodResult.kind !== 'success') {
    return { failure: classifyComposeMethodFailure(submissionMethodResult, '邮件提交失败。'), kind: 'failure' };
  }

  const createdSubmission = submissionMethodResult.response.created?.['send-submission'];
  const submissionCreateError = submissionMethodResult.response.notCreated?.['send-submission'];

  if (!createdSubmission) {
    return { failure: readInvocationError(submissionCreateError, '邮件提交失败。'), kind: 'failure' };
  }

  return {
    emailId: createdEmail.id,
    kind: 'success',
    submissionId: createdSubmission.id ?? null,
  };
}

export function buildUploadProxyPath(accountId: string) {
  return `/api/jmap/upload/${encodeURIComponent(accountId)}`;
}

export function uploadAttachmentThroughBff(input: {
  readonly accountId: string;
  readonly file: File;
  readonly onProgress: (progress: number) => void;
  readonly xhrFactory?: UploadFactory;
}): Promise<ComposeUploadResponse> {
  const xhrFactory = input.xhrFactory ?? XMLHttpRequest;

  return new Promise<ComposeUploadResponse>((resolve, reject) => {
    const xhr = new xhrFactory();
    xhr.open('POST', buildUploadProxyPath(input.accountId), true);
    xhr.responseType = 'text';
    xhr.setRequestHeader('content-type', input.file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(input.file.name));

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }

      input.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onerror = () => reject({ kind: 'network-failure', message: '附件上传网络中断，请稍后重试。' } satisfies ComposeSubmissionFailure);
    xhr.onload = () => {
      const payload = readUploadPayload(xhr);
      const message = payload && typeof payload.message === 'string' ? payload.message : '附件上传失败。';

      if (xhr.status === 401 || xhr.status === 403) {
        reject({ kind: 'auth-expired', message: '登录状态已失效，请重新登录。' } satisfies ComposeSubmissionFailure);
        return;
      }

      if (xhr.status === 413 || xhr.status === 415 || xhr.status === 422) {
        reject({ kind: 'attachment-rejected', message } satisfies ComposeSubmissionFailure);
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300 || !payload) {
        reject({ kind: 'network-failure', message } satisfies ComposeSubmissionFailure);
        return;
      }

      const accountId = typeof payload.accountId === 'string' ? payload.accountId : input.accountId;
      const blobId = typeof payload.blobId === 'string' ? payload.blobId : null;
      const size = typeof payload.size === 'number' ? payload.size : input.file.size;
      const type = typeof payload.type === 'string' ? payload.type : (input.file.type || 'application/octet-stream');

      if (!blobId) {
        reject({ kind: 'network-failure', message: '上传响应缺少 blobId。' } satisfies ComposeSubmissionFailure);
        return;
      }

      input.onProgress(100);
      resolve({ accountId, blobId, size, type });
    };

    xhr.send(input.file);
  });
}

type UploadPayload = {
  readonly accountId?: string;
  readonly blobId?: string;
  readonly message?: string;
  readonly size?: number;
  readonly type?: string;
};

function readUploadPayload(xhr: XMLHttpRequest): UploadPayload | null {
  const responseText = readSafeResponseText(xhr);

  if (!responseText) {
    return null;
  }

  try {
    const parsed = JSON.parse(responseText) as UploadPayload;
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function readSafeResponseText(xhr: XMLHttpRequest): string {
  if (xhr.responseType !== '' && xhr.responseType !== 'text') {
    return '';
  }

  try {
    return typeof xhr.responseText === 'string' ? xhr.responseText.trim() : '';
  } catch {
    return '';
  }
}

export function buildAttachmentPreviewUrl(downloadUrlTemplate: string, accountId: string, attachment: ComposeAttachmentRecord) {
  if (!attachment.blobId) {
    return null;
  }

  return buildBlobDownloadUrl(downloadUrlTemplate, accountId, attachment.blobId, {
    name: attachment.name,
    type: attachment.type,
  });
}
