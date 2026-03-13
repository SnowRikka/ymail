'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '@/components/system/toast-region';
import type { SafeSessionSummary } from '@/lib/auth/types';
import {
  areComposeFormStatesEqual,
  buildComposeDraftKey,
  buildComposePrefill,
  composeBodyWithQuotedContent,
  EMPTY_COMPOSE_FORM_STATE,
  extractEditableComposeBody,
  hydrateComposeServerDraft,
  hasComposeContent,
  isFreshComposeDraftId,
  parseComposeRouteState,
  type ComposeDraftRecord,
  type ComposeFormState,
  type ComposeQuotedContent,
  type ComposeValidationErrors,
  validateComposeForm,
} from '@/lib/jmap/compose-core';
import {
  createDraftStatus,
  destroyComposeDraft,
  findAttachmentFailure,
  fromStoredAttachments,
  hasPendingAttachment,
  persistComposeDraft,
  selectDefaultIdentityId,
  submitComposeMessage,
  toComposeIdentityOptions,
  toComposeMailboxRoleState,
  toStoredAttachments,
  uploadAttachmentThroughBff,
  type ComposeAttachmentRecord,
  type ComposeDraftStatus,
  type ComposeIdentityOption,
  type ComposeIdentityState,
  type ComposeSubmissionFailure,
} from '@/lib/jmap/compose-submit';
import { queryReaderThread } from '@/lib/jmap/message-reader';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';
import type { JmapMailboxObject, JmapQuerySort } from '@/lib/jmap/types';
import { useComposeDraftStore } from '@/lib/state/compose-store';

type ComposeFormPhase = 'draft' | 'empty' | 'prefill' | 'warning';

type ComposeActionState =
  | { readonly kind: 'idle'; readonly message: null }
  | { readonly kind: 'info'; readonly message: string }
  | { readonly kind: 'saved'; readonly message: string }
  | { readonly kind: 'warning'; readonly message: string };

interface ComposeInitialLoad {
  readonly attachments: readonly ComposeAttachmentRecord[];
  readonly form: ComposeFormState;
  readonly identityId: string | null;
  readonly message: string | null;
  readonly phase: ComposeFormPhase;
  readonly preferredIdentityEmail: string | null;
  readonly quoted: ComposeQuotedContent | null;
}

interface DraftSnapshot {
  readonly attachments: readonly ComposeAttachmentRecord[];
  readonly form: ComposeFormState;
  readonly identityId: string | null;
  readonly quoted: ComposeQuotedContent | null;
}

type DraftPersistenceReason = 'autosave' | 'blur' | 'close' | 'failure';

const AUTOSAVE_INTERVAL_MS = 12_000;
const EMPTY_ERRORS: ComposeValidationErrors = { body: null, subject: null, to: null };
const IDENTITY_PROPERTIES = ['id', 'name', 'email', 'replyTo', 'bcc', 'textSignature'] as const;
const MAILBOX_PROPERTIES = ['id', 'name', 'role', 'sortOrder'] as const;
const SERVER_DRAFT_BODY_PROPERTIES = ['partId', 'blobId', 'name', 'size', 'type'] as const;
const SERVER_DRAFT_PROPERTIES = ['id', 'from', 'to', 'subject', 'textBody', 'bodyValues', 'attachments'] as const;
const MAILBOX_QUERY_SORT: readonly JmapQuerySort[] = [
  { isAscending: true, property: 'sortOrder' },
  { isAscending: true, property: 'name' },
];

function resolveComposeAccountId(routeAccountId: string | null, bootstrap: ReturnType<typeof useJmapBootstrap>['data']) {
  if (bootstrap?.status !== 'ready') {
    return routeAccountId;
  }

  if (routeAccountId && bootstrap.session.accounts[routeAccountId]) {
    return routeAccountId;
  }

  return bootstrap.session.primaryAccounts.mail ?? Object.keys(bootstrap.session.accounts)[0] ?? null;
}

function formatDraftTimestamp(value: number) {
  return new Intl.DateTimeFormat('zh-CN', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: '2-digit' }).format(new Date(value));
}

function buildFallbackCloseHref(accountId: string | null) {
  return accountId ? `/mail/inbox?accountId=${encodeURIComponent(accountId)}` : '/mail/inbox';
}

function selectIdentityIdByEmail(identities: readonly ComposeIdentityOption[], email: string | null) {
  const normalizedEmail = email?.trim().toLowerCase() ?? '';

  if (normalizedEmail.length === 0) {
    return null;
  }

  return identities.find((identity) => identity.email.toLowerCase() === normalizedEmail)?.id ?? null;
}

function intentTitle(intent: ReturnType<typeof parseComposeRouteState>['intent']) {
  switch (intent) {
    case 'reply':
      return '回复邮件';
    case 'forward':
      return '转发邮件';
    default:
      return '新建邮件';
  }
}

function buildAttachmentSignature(attachments: readonly ComposeAttachmentRecord[]) {
  return JSON.stringify(
    attachments.map((attachment) => ({
      blobId: attachment.blobId,
      errorMessage: attachment.errorMessage,
      name: attachment.name,
      progress: attachment.progress,
      size: attachment.size,
      state: attachment.state,
      type: attachment.type,
    })),
  );
}

function formatAttachmentStateLabel(state: ComposeAttachmentRecord['state']) {
  switch (state) {
    case 'failed':
      return '上传失败';
    case 'queued':
      return '等待上传';
    case 'rejected':
      return '已拒绝';
    case 'uploaded':
      return '已上传';
    case 'uploading':
      return '上传中';
    default:
      return state;
  }
}

export function ComposeForm({ sessionSummary }: { readonly sessionSummary?: SafeSessionSummary | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const client = useJmapClient();
  const bootstrapQuery = useJmapBootstrap(true);
  const { notify } = useToast();
  const routeState = useMemo(() => parseComposeRouteState(searchParams), [searchParams]);
  const accountId = resolveComposeAccountId(routeState.accountId, bootstrapQuery.data);
  const draftKey = buildComposeDraftKey({ accountId, draftId: routeState.draftId, intent: routeState.intent, messageId: routeState.messageId, threadId: routeState.threadId });
  const allDrafts = useComposeDraftStore((state) => state.drafts);
  const isServerDraftRoute = routeState.intent === 'new' && Boolean(routeState.draftId) && !isFreshComposeDraftId(routeState.draftId);
  const matchedServerDraftEntry = useMemo(() => {
    if (!isServerDraftRoute || allDrafts[draftKey]) {
      return null;
    }

    return Object.entries(allDrafts).find(([, draft]) => draft.serverDraftId === routeState.draftId) ?? null;
  }, [allDrafts, draftKey, isServerDraftRoute, routeState.draftId]);
  const storedDraft = allDrafts[draftKey] ?? matchedServerDraftEntry?.[1] ?? null;
  const storedDraftKey = matchedServerDraftEntry?.[0] ?? draftKey;
  const routeServerDraftId = isServerDraftRoute ? routeState.draftId : null;
  const [formState, setFormState] = useState<ComposeFormState>(EMPTY_COMPOSE_FORM_STATE);
  const [baselineState, setBaselineState] = useState<ComposeFormState>(EMPTY_COMPOSE_FORM_STATE);
  const [attachments, setAttachments] = useState<readonly ComposeAttachmentRecord[]>([]);
  const [baselineAttachmentSignature, setBaselineAttachmentSignature] = useState<string>(buildAttachmentSignature([]));
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [baselineIdentityId, setBaselineIdentityId] = useState<string | null>(null);
  const [quotedContent, setQuotedContent] = useState<ComposeQuotedContent | null>(null);
  const [validationErrors, setValidationErrors] = useState<ComposeValidationErrors>(EMPTY_ERRORS);
  const [actionState, setActionState] = useState<ComposeActionState>({ kind: 'idle', message: null });
  const [draftStatus, setDraftStatus] = useState<ComposeDraftStatus>(createDraftStatus('idle'));
  const [sendFailure, setSendFailure] = useState<ComposeSubmissionFailure | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [identityState, setIdentityState] = useState<ComposeIdentityState>({ kind: 'loading' });
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);
  const initializedDraftSignatureRef = useRef<string | null>(null);
  const hasLocalSessionChangesRef = useRef(false);
  const latestSnapshotRef = useRef<DraftSnapshot>({ attachments: [], form: EMPTY_COMPOSE_FORM_STATE, identityId: null, quoted: null });
  const latestRouteStateRef = useRef(routeState);
  const latestAccountIdRef = useRef(accountId);
  const hasSentRef = useRef(false);
  const isMountedRef = useRef(true);
  const serverDraftIdRef = useRef<string | null>(storedDraft?.serverDraftId ?? routeServerDraftId);
  const serverDraftQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const selfEmail = sessionSummary?.username?.trim().toLowerCase() ?? null;
  const needsQuotedPrefill = routeState.intent !== 'new';
  const fallbackCloseHref = buildFallbackCloseHref(accountId);
  const returnToHref = routeState.returnTo ?? fallbackCloseHref;

  const threadQuery = useQuery({
    enabled: needsQuotedPrefill && Boolean(accountId && routeState.threadId) && (!storedDraft || !storedDraft.quoted),
    queryFn: () => queryReaderThread({ accountId: accountId as string, client, threadId: routeState.threadId as string }),
    queryKey: ['compose-thread-source', accountId, routeState.threadId],
    staleTime: 1000 * 30,
  });

  const serverDraftQuery = useQuery({
    enabled: isServerDraftRoute && Boolean(accountId && routeServerDraftId) && !storedDraft,
    queryFn: async () => {
      const result = await client.email.get({
        accountId: accountId as string,
        bodyProperties: SERVER_DRAFT_BODY_PROPERTIES,
        fetchTextBodyValues: true,
        ids: [routeServerDraftId as string],
        maxBodyValueBytes: 2_000_000,
        properties: SERVER_DRAFT_PROPERTIES,
      });

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      if (result.result.kind !== 'success') {
        throw new Error(result.result.error.description ?? '服务器草稿读取失败。');
      }

      const email = result.result.response.list[0];
      return email ? hydrateComposeServerDraft(email) : null;
    },
    queryKey: ['compose-server-draft', accountId, routeServerDraftId],
    staleTime: 1000 * 30,
  });

  const identityQuery = useQuery({
    enabled: Boolean(accountId),
    queryFn: async () => {
      const result = await client.identity.get({ accountId: accountId as string, properties: IDENTITY_PROPERTIES });

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      if (result.result.kind !== 'success') {
        throw new Error(result.result.error.description ?? '发件身份读取失败。');
      }

      return toComposeIdentityOptions(result.result.response.list);
    },
    queryKey: ['compose-identities', accountId],
    staleTime: 1000 * 60,
  });

  const mailboxQuery = useQuery({
    enabled: Boolean(accountId),
    queryFn: async () => {
      const queryResult = await client.mailbox.query({ accountId: accountId as string, sort: MAILBOX_QUERY_SORT });

      if (!queryResult.ok) {
        throw new Error(queryResult.error.message);
      }

      if (queryResult.result.kind !== 'success') {
        throw new Error(queryResult.result.error.description ?? '邮箱列表查询失败。');
      }

      if (queryResult.result.response.ids.length === 0) {
        return [] as readonly JmapMailboxObject[];
      }

      const getResult = await client.mailbox.get({ accountId: accountId as string, ids: queryResult.result.response.ids, properties: MAILBOX_PROPERTIES });

      if (!getResult.ok) {
        throw new Error(getResult.error.message);
      }

      if (getResult.result.kind !== 'success') {
        throw new Error(getResult.result.error.description ?? '邮箱详情读取失败。');
      }

      return getResult.result.response.list;
    },
    queryKey: ['compose-mailboxes', accountId],
    staleTime: 1000 * 60,
  });

  const mailboxRoleState = useMemo(() => toComposeMailboxRoleState(mailboxQuery.data ?? []), [mailboxQuery.data]);
  const selectedIdentity = identityState.kind === 'ready'
    ? identityState.identities.find((identity) => identity.id === selectedIdentityId) ?? null
    : null;
  const quotedPrefill = useMemo(() => {
    if (!threadQuery.data) {
      return null;
    }

    return buildComposePrefill({ intent: routeState.intent, messageId: routeState.messageId, selfEmail, thread: threadQuery.data });
  }, [routeState.intent, routeState.messageId, selfEmail, threadQuery.data]);

  const initialLoad = useMemo<ComposeInitialLoad | null>(() => {
    if (storedDraft) {
      if (needsQuotedPrefill && !storedDraft.quoted && threadQuery.isLoading) {
        return null;
      }

      const storedQuoted = storedDraft.quoted ?? quotedPrefill?.quoted ?? null;

      return {
        attachments: fromStoredAttachments(storedDraft.attachments ?? []),
        form: storedQuoted
          ? { ...storedDraft.form, body: extractEditableComposeBody(storedDraft.form.body, storedQuoted) }
          : storedDraft.form,
        identityId: storedDraft.identityId ?? null,
        message: `已恢复 ${formatDraftTimestamp(storedDraft.updatedAt)} 暂存的草稿。`,
        phase: 'draft',
        preferredIdentityEmail: null,
        quoted: storedQuoted,
      };
    }

    if (isServerDraftRoute) {
      if (!accountId || !routeServerDraftId) {
        return {
          attachments: [],
          form: EMPTY_COMPOSE_FORM_STATE,
          identityId: null,
          message: '缺少服务器草稿上下文，已回退为空白草稿。',
          phase: 'warning',
          preferredIdentityEmail: null,
          quoted: null,
        };
      }

      if (serverDraftQuery.isLoading) {
        return null;
      }

      if (serverDraftQuery.isError || !serverDraftQuery.data) {
        return {
          attachments: [],
          form: EMPTY_COMPOSE_FORM_STATE,
          identityId: null,
          message: serverDraftQuery.isError
            ? (serverDraftQuery.error instanceof Error ? serverDraftQuery.error.message : '服务器草稿读取失败，已回退为空白草稿。')
            : '未找到对应的服务器草稿，已回退为空白草稿。',
          phase: 'warning',
          preferredIdentityEmail: null,
          quoted: null,
        };
      }

      return {
        attachments: fromStoredAttachments(serverDraftQuery.data.attachments),
        form: serverDraftQuery.data.form,
        identityId: null,
        message: '已载入服务器草稿。',
        phase: 'draft',
        preferredIdentityEmail: serverDraftQuery.data.identityEmail,
        quoted: null,
      };
    }

    if (!needsQuotedPrefill) {
      return { attachments: [], form: EMPTY_COMPOSE_FORM_STATE, identityId: null, message: null, phase: 'empty', preferredIdentityEmail: null, quoted: null };
    }

    if (!accountId || !routeState.threadId) {
      return { attachments: [], form: EMPTY_COMPOSE_FORM_STATE, identityId: null, message: '缺少引用上下文，已回退为空白草稿。', phase: 'warning', preferredIdentityEmail: null, quoted: null };
    }

    if (threadQuery.isLoading) {
      return null;
    }

    if (threadQuery.isError || !threadQuery.data) {
      return {
        attachments: [],
        form: EMPTY_COMPOSE_FORM_STATE,
        identityId: null,
        message: threadQuery.isError ? (threadQuery.error instanceof Error ? threadQuery.error.message : '引用邮件读取失败，已回退为空白草稿。') : '未找到可引用的线程内容，已回退为空白草稿。',
        phase: 'warning',
        preferredIdentityEmail: null,
        quoted: null,
      };
    }

    return {
      attachments: [],
      form: quotedPrefill?.form ?? EMPTY_COMPOSE_FORM_STATE,
      identityId: null,
      message: null,
      phase: 'prefill',
      preferredIdentityEmail: null,
      quoted: quotedPrefill?.quoted ?? null,
    };
  }, [accountId, isServerDraftRoute, needsQuotedPrefill, quotedPrefill, routeServerDraftId, serverDraftQuery.data, serverDraftQuery.error, serverDraftQuery.isError, serverDraftQuery.isLoading, routeState.threadId, storedDraft, threadQuery.data, threadQuery.error, threadQuery.isError, threadQuery.isLoading]);
  const draftPreferredIdentityId = useMemo(() => {
    if (initialLoad?.identityId) {
      return initialLoad.identityId;
    }

    return selectIdentityIdByEmail(identityQuery.data ?? [], initialLoad?.preferredIdentityEmail ?? null);
  }, [identityQuery.data, initialLoad?.identityId, initialLoad?.preferredIdentityEmail]);

  const attachmentSignature = useMemo(() => buildAttachmentSignature(attachments), [attachments]);
  const isDirty = !areComposeFormStatesEqual(formState, baselineState)
    || attachmentSignature !== baselineAttachmentSignature
    || selectedIdentityId !== baselineIdentityId;

  useEffect(() => {
    latestSnapshotRef.current = { attachments, form: formState, identityId: selectedIdentityId, quoted: quotedContent };
    latestRouteStateRef.current = routeState;
    latestAccountIdRef.current = accountId;
  }, [accountId, attachments, formState, quotedContent, routeState, selectedIdentityId]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (identityQuery.isLoading) {
      setIdentityState({ kind: 'loading' });
      return;
    }

    if (identityQuery.isError) {
      setIdentityState({ kind: 'error', message: identityQuery.error instanceof Error ? identityQuery.error.message : '发件身份读取失败。' });
      return;
    }

    const identities = identityQuery.data ?? [];
    setIdentityState({ kind: 'ready', identities, selectedIdentityId: selectDefaultIdentityId(identities, selectedIdentityId, draftPreferredIdentityId) });
  }, [draftPreferredIdentityId, identityQuery.data, identityQuery.error, identityQuery.isError, identityQuery.isLoading, selectedIdentityId]);

  useEffect(() => {
    if (identityState.kind !== 'ready') {
      return;
    }

    const nextIdentityId = selectDefaultIdentityId(identityState.identities, selectedIdentityId, draftPreferredIdentityId);

    if (nextIdentityId !== selectedIdentityId) {
      setSelectedIdentityId(nextIdentityId);
    }
  }, [draftPreferredIdentityId, identityState, selectedIdentityId]);

  useEffect(() => {
    if (!initialLoad) {
      return;
    }

    const signature = `${storedDraftKey}:${initialLoad.phase}:${storedDraft?.updatedAt ?? routeServerDraftId ?? 'fresh'}`;

    if (initializedDraftSignatureRef.current === signature) {
      return;
    }

    if (initializedDraftSignatureRef.current?.startsWith(`${storedDraftKey}:`) && hasLocalSessionChangesRef.current) {
      return;
    }

    const initialIdentityId = initialLoad.identityId;
    initializedDraftSignatureRef.current = signature;
    hasLocalSessionChangesRef.current = false;
    serverDraftIdRef.current = storedDraft?.serverDraftId ?? routeServerDraftId;
    setFormState(initialLoad.form);
    setBaselineState(initialLoad.form);
    setAttachments(initialLoad.attachments);
    setBaselineAttachmentSignature(buildAttachmentSignature(initialLoad.attachments));
    setSelectedIdentityId(initialIdentityId);
    setBaselineIdentityId(initialIdentityId);
    setQuotedContent(initialLoad.quoted);
    setValidationErrors(EMPTY_ERRORS);
    setDraftStatus(createDraftStatus('idle', initialLoad.message ?? '等待修改'));
    setSendFailure(null);
    setActionState(initialLoad.message ? { kind: initialLoad.phase === 'warning' ? 'warning' : 'info', message: initialLoad.message } : { kind: 'idle', message: null });
    hasSentRef.current = false;

    queueMicrotask(() => {
      if (routeState.intent === 'new') {
        toRef.current?.focus();
        return;
      }

      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(0, 0);
    });
  }, [initialLoad, routeServerDraftId, routeState.intent, storedDraft?.serverDraftId, storedDraft?.updatedAt, storedDraftKey]);

  const buildStoredDraftRecord = useCallback((snapshot: DraftSnapshot, updatedAt: number, serverDraftId: string | null): ComposeDraftRecord => ({
    accountId: latestAccountIdRef.current,
    attachments: toStoredAttachments(snapshot.attachments),
    form: snapshot.form,
    identityId: snapshot.identityId,
    intent: latestRouteStateRef.current.intent,
    messageId: latestRouteStateRef.current.messageId,
    quoted: snapshot.quoted,
    returnTo: latestRouteStateRef.current.returnTo,
    serverDraftId,
    threadId: latestRouteStateRef.current.threadId,
    updatedAt,
  }), []);

  const storeDraftLocally = useCallback((snapshot: DraftSnapshot, serverDraftId: string | null = serverDraftIdRef.current) => {
    useComposeDraftStore.getState().saveDraft(storedDraftKey, buildStoredDraftRecord(snapshot, Date.now(), serverDraftId));
  }, [buildStoredDraftRecord, storedDraftKey]);

  const clearStoredDraft = useCallback(() => {
    const store = useComposeDraftStore.getState();
    store.clearDraft(storedDraftKey);

    if (storedDraftKey !== draftKey) {
      store.clearDraft(draftKey);
    }
  }, [draftKey, storedDraftKey]);

  const resolveMailboxRoleStateForPersistence = useCallback(async () => {
    if (mailboxRoleState.draftsId) {
      return mailboxRoleState;
    }

    const activeAccountId = latestAccountIdRef.current;

    if (!activeAccountId) {
      return mailboxRoleState;
    }

    const queryResult = await client.mailbox.query({ accountId: activeAccountId, sort: MAILBOX_QUERY_SORT });

    if (!queryResult.ok || queryResult.result.kind !== 'success' || queryResult.result.response.ids.length === 0) {
      return mailboxRoleState;
    }

    const getResult = await client.mailbox.get({ accountId: activeAccountId, ids: queryResult.result.response.ids, properties: MAILBOX_PROPERTIES });

    if (!getResult.ok || getResult.result.kind !== 'success') {
      return mailboxRoleState;
    }

    return toComposeMailboxRoleState(getResult.result.response.list);
  }, [client, mailboxRoleState]);

  const resolvePersistenceIdentity = useCallback((identityId: string | null) => {
    if (identityState.kind !== 'ready') {
      return null;
    }

    return identityState.identities.find((identity) => identity.id === identityId)
      ?? identityState.identities.find((identity) => identity.id === identityState.selectedIdentityId)
      ?? identityState.identities[0]
      ?? null;
  }, [identityState]);

  const queueServerDraftSave = useCallback((snapshot: DraftSnapshot, suppressState = false) => {
    const persistedSnapshot: DraftSnapshot = {
      attachments: [...snapshot.attachments],
      form: { ...snapshot.form },
      identityId: snapshot.identityId,
      quoted: snapshot.quoted,
    };

    const queued = serverDraftQueueRef.current.then(async () => {
      const activeAccountId = latestAccountIdRef.current;

      if (!activeAccountId) {
        return false;
      }

      const resolvedMailboxRoleState = await resolveMailboxRoleStateForPersistence();

      const result = await persistComposeDraft({
        accountId: activeAccountId,
        attachments: persistedSnapshot.attachments,
        client,
        draftEmailId: serverDraftIdRef.current,
        form: { ...persistedSnapshot.form, body: composeBodyWithQuotedContent(persistedSnapshot.form.body, persistedSnapshot.quoted) },
        identity: resolvePersistenceIdentity(persistedSnapshot.identityId),
        mailboxRoleState: resolvedMailboxRoleState,
      });

      if (result.kind === 'failure') {
        if (!suppressState && isMountedRef.current) {
          setDraftStatus(createDraftStatus('error', result.failure.message));
        }

        return false;
      }

      serverDraftIdRef.current = result.draftEmailId;
      storeDraftLocally(persistedSnapshot, result.draftEmailId);
      return true;
    });

    serverDraftQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [client, resolveMailboxRoleStateForPersistence, resolvePersistenceIdentity, storeDraftLocally]);

  const queueServerDraftDestroy = useCallback((suppressState = false) => {
    const activeAccountId = latestAccountIdRef.current;
    const activeServerDraftId = serverDraftIdRef.current;

    if (!activeAccountId || !activeServerDraftId) {
      return Promise.resolve();
    }

    const queued = serverDraftQueueRef.current.then(async () => {
      const result = await destroyComposeDraft({
        accountId: activeAccountId,
        client,
        draftEmailId: activeServerDraftId,
      });

      if (result.kind === 'failure') {
        if (!suppressState && isMountedRef.current) {
          setDraftStatus(createDraftStatus('error', result.failure.message));
        }

        return;
      }

      serverDraftIdRef.current = null;
    });

    serverDraftQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, [client]);

  const persistDraft = useCallback(async (snapshot?: DraftSnapshot, reason: DraftPersistenceReason = 'autosave') => {
    const activeSnapshot = snapshot ?? latestSnapshotRef.current;
    hasLocalSessionChangesRef.current = true;

    if (!hasComposeContent({ ...activeSnapshot.form, body: composeBodyWithQuotedContent(activeSnapshot.form.body, activeSnapshot.quoted) }) && activeSnapshot.attachments.length === 0) {
      clearStoredDraft();
      setDraftStatus(createDraftStatus('idle', reason === 'close' ? '空白草稿已清理。' : '等待修改'));
      setBaselineState(activeSnapshot.form);
      setBaselineAttachmentSignature(buildAttachmentSignature(activeSnapshot.attachments));
      setBaselineIdentityId(activeSnapshot.identityId);

      if (serverDraftIdRef.current) {
        if (reason === 'close') {
          await queueServerDraftDestroy();
        } else {
          void queueServerDraftDestroy();
        }
      }

      return 'empty' as const;
    }

    setDraftStatus(createDraftStatus('saving', reason === 'blur' ? '字段失焦后已触发保存…' : '草稿保存中…'));
    storeDraftLocally(activeSnapshot);
    setBaselineState(activeSnapshot.form);
    setBaselineAttachmentSignature(buildAttachmentSignature(activeSnapshot.attachments));
    setBaselineIdentityId(activeSnapshot.identityId);

    if (reason === 'close') {
      const remoteSaved = await queueServerDraftSave(activeSnapshot);

      if (!remoteSaved) {
        return 'failed' as const;
      }
    } else {
      void queueServerDraftSave(activeSnapshot);
    }

    setDraftStatus(createDraftStatus('saved', reason === 'close' ? '草稿已暂存，本次关闭不会丢失输入内容。' : '草稿已自动保存。'));
    return 'saved' as const;
  }, [clearStoredDraft, queueServerDraftDestroy, queueServerDraftSave, storeDraftLocally]);

  useEffect(() => {
    if (!isDirty || isSending) {
      return;
    }

    const timer = window.setInterval(() => {
      persistDraft(undefined, 'autosave');
    }, AUTOSAVE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isDirty, isSending, persistDraft]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => () => {
    const latestSnapshot = latestSnapshotRef.current;

    if (hasSentRef.current) {
      return;
    }

    if (!hasComposeContent({ ...latestSnapshot.form, body: composeBodyWithQuotedContent(latestSnapshot.form.body, latestSnapshot.quoted) }) && latestSnapshot.attachments.length === 0) {
      clearStoredDraft();

      if (serverDraftIdRef.current) {
        void queueServerDraftDestroy(true);
      }

      return;
    }

    storeDraftLocally(latestSnapshot);
    void queueServerDraftSave(latestSnapshot, true);
  }, [clearStoredDraft, queueServerDraftDestroy, queueServerDraftSave, storeDraftLocally]);

  const updateField = <Key extends keyof ComposeFormState>(key: Key, value: ComposeFormState[Key]) => {
    hasLocalSessionChangesRef.current = true;
    setFormState((current) => ({ ...current, [key]: value }));

    if (validationErrors[key]) {
      setValidationErrors((current) => ({ ...current, [key]: null }));
    }

    if (actionState.kind !== 'idle') {
      setActionState({ kind: 'idle', message: null });
    }

    if (sendFailure) {
      setSendFailure(null);
    }

    setDraftStatus(createDraftStatus('idle'));
  };

  const handleFieldBlur = () => {
    void persistDraft({ attachments, form: formState, identityId: selectedIdentityId, quoted: quotedContent }, 'blur');
  };

  const saveDraftAndClose = async () => {
    const result = await persistDraft({ attachments, form: formState, identityId: selectedIdentityId, quoted: quotedContent }, 'close');
    const saved = result === 'saved';

    if (result === 'failed') {
      setActionState({ kind: 'warning', message: '草稿保存失败，当前内容仍保留在本地。' });
      return;
    }

    setActionState(saved ? { kind: 'saved', message: '草稿已暂存，本次关闭不会丢失输入内容。' } : { kind: 'info', message: '当前草稿为空，已直接关闭。' });

    if (saved) {
      notify('草稿已暂存。');
    }

    router.push(returnToHref);
  };

  const handleAttachmentSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (!accountId || files.length === 0) {
      return;
    }

    hasLocalSessionChangesRef.current = true;
    const nextQueued = files.map<ComposeAttachmentRecord>((file, index) => ({
      blobId: null,
      errorMessage: null,
      id: `attachment-${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      size: file.size,
      state: 'queued',
      type: file.type || null,
    }));

    setAttachments((current) => [...current, ...nextQueued]);
    setDraftStatus(createDraftStatus('saving', '附件队列已加入，正在上传…'));
    setSendFailure(null);

    for (const queuedAttachment of nextQueued) {
      setAttachments((current) => current.map((attachment) => attachment.id === queuedAttachment.id ? { ...attachment, state: 'uploading' } : attachment));

      try {
        const uploaded = await uploadAttachmentThroughBff({
          accountId,
          file: files.find((file) => file.name === queuedAttachment.name && file.size === queuedAttachment.size) as File,
          onProgress: (progress) => {
            setAttachments((current) => current.map((attachment) => attachment.id === queuedAttachment.id ? { ...attachment, progress, state: 'uploading' } : attachment));
          },
        });

        setAttachments((current) => current.map((attachment) => attachment.id === queuedAttachment.id ? {
          ...attachment,
          blobId: uploaded.blobId,
          errorMessage: null,
          progress: 100,
          state: 'uploaded',
          type: uploaded.type,
        } : attachment));
      } catch (error) {
        const failure = (typeof error === 'object' && error && 'kind' in error && 'message' in error)
          ? (error as ComposeSubmissionFailure)
          : ({ kind: 'network-failure', message: '附件上传失败。' } satisfies ComposeSubmissionFailure);

        setAttachments((current) => current.map((attachment) => attachment.id === queuedAttachment.id ? {
          ...attachment,
          errorMessage: failure.message,
          progress: 0,
          state: failure.kind === 'attachment-rejected' ? 'rejected' : 'failed',
        } : attachment));
        setSendFailure(failure);
      }
    }

    void persistDraft({ attachments: latestSnapshotRef.current.attachments, form: latestSnapshotRef.current.form, identityId: latestSnapshotRef.current.identityId, quoted: latestSnapshotRef.current.quoted }, 'autosave');
  };

  const handleSend = async () => {
    if (isSending || hasSentRef.current) {
      return;
    }

    const validation = validateComposeForm(formState);

    if (!validation.ok) {
      setValidationErrors(validation.errors);
      setActionState({ kind: 'warning', message: validation.errors.to ?? '发送前校验未通过。' });
      return;
    }

    if (!selectedIdentity) {
      setSendFailure({ kind: 'upstream-validation', message: '请选择可用发件身份。' });
      return;
    }

    const attachmentFailure = findAttachmentFailure(attachments);

    if (attachmentFailure) {
      setSendFailure(attachmentFailure);
      return;
    }

    if (hasPendingAttachment(attachments)) {
      setSendFailure({ kind: 'attachment-rejected', message: '附件仍在上传，请等待完成后再发送。' });
      return;
    }

    setValidationErrors(EMPTY_ERRORS);
    setSendFailure(null);
    setIsSending(true);
    setActionState({ kind: 'info', message: '正在提交到上游邮箱服务…' });

    const result = await submitComposeMessage({ accountId: accountId as string, attachments, client, form: { ...formState, body: composeBodyWithQuotedContent(formState.body, quotedContent) }, identity: selectedIdentity, mailboxRoleState });

    setIsSending(false);

    if (result.kind === 'failure') {
      setSendFailure(result.failure);
      setActionState({ kind: 'warning', message: result.failure.message });
      void persistDraft({ attachments, form: formState, identityId: selectedIdentityId, quoted: quotedContent }, 'failure');
      return;
    }

    hasSentRef.current = true;
    if (serverDraftIdRef.current && accountId) {
      await queueServerDraftDestroy();
    }
    clearStoredDraft();
    serverDraftIdRef.current = null;
    setBaselineState(formState);
    setBaselineAttachmentSignature(buildAttachmentSignature(attachments));
    setBaselineIdentityId(selectedIdentityId);
    setDraftStatus(createDraftStatus('saved', '上游提交成功，草稿已完成。'));
    setActionState({ kind: 'saved', message: '邮件已发送，正在返回上一界面。' });
    notify('邮件已发送。');
    router.push(returnToHref);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    const withCommand = event.metaKey || event.ctrlKey;

    if (withCommand && event.key === 'Enter') {
      event.preventDefault();
      void handleSend();
      return;
    }

    if (withCommand && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveDraftAndClose();
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[22px] border border-line/70 bg-canvas/72 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-ink">{intentTitle(routeState.intent)}</h2>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted">
            <span className="rounded-full border border-line/70 px-2.5 py-1 font-mono uppercase tracking-[0.18em]">自动暂存</span>
          </div>
        </div>
      </section>

      {actionState.message ? (
        <div aria-live="polite" className={[
          'rounded-[20px] border px-4 py-3 text-sm leading-7',
          actionState.kind === 'warning' ? 'border-amber-500/25 bg-amber-500/8 text-muted' : actionState.kind === 'saved' ? 'border-accent/30 bg-accent/10 text-ink' : 'border-line/70 bg-canvas/62 text-muted',
        ].join(' ')}>
          {actionState.message}
        </div>
      ) : null}

      {sendFailure ? (
        <div className="rounded-[20px] border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm leading-7 text-muted" data-testid="send-error-banner" role="alert">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-300">{sendFailure.kind}</span>
          <p className="mt-2">{sendFailure.message}</p>
        </div>
      ) : null}

      {initialLoad === null ? (
        <div aria-busy="true" className="space-y-3">
          <div className="loading-shimmer h-16 rounded-[20px] border border-line/70 bg-canvas/55" />
          <div className="loading-shimmer h-[420px] rounded-[24px] border border-line/70 bg-canvas/55" />
        </div>
      ) : (
        <form className="space-y-4" data-testid="compose-form" onKeyDown={handleKeyDown}>
          <section className="rounded-[24px] border border-line/80 bg-canvas/66 p-4 lg:p-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="block text-sm text-ink">
                发件身份
                <select
                  aria-label="发件身份"
                  className="mt-2 min-h-[52px] w-full rounded-2xl border border-line bg-panel/90 px-4 py-3 text-sm text-ink outline-none transition hover:border-accent/40 focus:border-accent"
                  data-testid="identity-select"
                  disabled={identityState.kind !== 'ready' || identityState.identities.length === 0}
                  onBlur={handleFieldBlur}
                  onChange={(event) => {
                    hasLocalSessionChangesRef.current = true;
                    setSelectedIdentityId(event.target.value || null);
                    setDraftStatus(createDraftStatus('idle'));
                  }}
                  value={selectedIdentityId ?? ''}
                >
                  <option value="">{identityState.kind === 'error' ? '身份读取失败' : identityState.kind === 'loading' ? '身份载入中…' : '请选择发件身份'}</option>
                  {identityState.kind === 'ready' ? identityState.identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}</option>) : null}
                </select>
              </label>

              <div className="block text-sm text-ink">
                <div className="mt-2 flex min-h-[52px] items-center justify-between gap-4 rounded-2xl border border-line/70 bg-panel/72 px-4 py-3 text-sm text-muted" data-testid="draft-status-field">
                  <p className="shrink-0 text-[11px] uppercase tracking-[0.24em] text-accent/80">草稿状态</p>
                  <p aria-live="polite" className="text-right" data-testid="draft-status">{draftStatus.message}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="block text-sm text-ink">
                收件人
                <input
                  aria-describedby="compose-to-hint compose-to-error"
                  aria-invalid={validationErrors.to ? 'true' : 'false'}
                  className="mt-2 w-full rounded-2xl border border-line bg-panel/90 px-4 py-3 text-sm text-ink outline-none transition hover:border-accent/40 focus:border-accent"
                  data-testid="compose-to"
                  onBlur={handleFieldBlur}
                  onChange={(event) => updateField('to', event.target.value)}
                  placeholder="例如：Alice <alice@example.com>, team@example.com"
                  ref={toRef}
                  value={formState.to}
                />
                <span className="mt-2 block text-xs leading-6 text-muted" id="compose-to-hint">支持逗号、分号或换行分隔；回复类场景会自动去重并排除当前账号。</span>
                {validationErrors.to ? <span className="mt-2 block text-xs leading-6 text-amber-300" id="compose-to-error">{validationErrors.to}</span> : null}
              </label>

              <label className="block text-sm text-ink">
                主题
                <input
                  aria-label="主题"
                  className="mt-2 w-full rounded-2xl border border-line bg-panel/90 px-4 py-3 text-sm text-ink outline-none transition hover:border-accent/40 focus:border-accent"
                  data-testid="compose-subject"
                  onBlur={handleFieldBlur}
                  onChange={(event) => updateField('subject', event.target.value)}
                  placeholder="写一行清晰主题"
                  value={formState.subject}
                />
              </label>
            </div>

            <label className="mt-4 block text-sm text-ink">
              正文
              <textarea
                aria-label="正文"
                className="mt-2 min-h-[260px] w-full rounded-[28px] border border-line bg-panel/90 px-4 py-4 text-sm leading-7 text-ink outline-none transition hover:border-accent/40 focus:border-accent sm:min-h-[320px]"
                data-testid="compose-body"
                onBlur={handleFieldBlur}
                onChange={(event) => updateField('body', event.target.value)}
                placeholder="纯文本写作区。引用原文会单独显示在下方，只读且会在保存/发送时自动拼回正文。"
                ref={bodyRef}
                value={formState.body}
              />
            </label>

            {quotedContent ? (
              <section className="mt-4 rounded-[24px] border border-dashed border-line/80 bg-canvas/58 p-4" data-testid="compose-quoted-block">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[11px] uppercase tracking-[0.28em] text-accent/80">只读引用</span>
                  <span className="rounded-full border border-line/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">发送/暂存时自动附带</span>
                </div>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-[20px] border border-line/70 bg-panel/72 px-4 py-4 text-sm leading-7 text-muted" data-testid="compose-quoted-content">{quotedContent.body}</pre>
              </section>
            ) : null}

            <section className="mt-4 rounded-[24px] border border-line/80 bg-canvas/62 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-[11px] uppercase tracking-[0.24em] text-accent/80">附件</p>
                <>
                  <input data-testid="attachment-upload" hidden multiple onChange={(event) => { void handleAttachmentSelect(event); }} ref={fileInputRef} type="file" />
                  <button className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line/80 bg-panel/84 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/50 hover:text-accent" onClick={() => fileInputRef.current?.click()} type="button">
                    选择附件
                  </button>
                </>
              </div>

              <div className="mt-4 space-y-3" data-testid="attachment-progress">
                {attachments.length === 0 ? <p className="text-sm text-muted">尚未添加附件。</p> : attachments.map((attachment) => (
                  <div className="rounded-[18px] border border-line/70 bg-panel/72 px-4 py-3" key={attachment.id}>
                    <div className="flex items-center justify-between gap-3 text-sm text-ink">
                      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{formatAttachmentStateLabel(attachment.state)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas/80" role="progressbar" aria-label={`${attachment.name} 上传进度`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={attachment.progress} aria-valuetext={`${formatAttachmentStateLabel(attachment.state)}，${attachment.progress}%`}>
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${attachment.progress}%` }} />
                    </div>
                    <p className="mt-2 text-xs leading-6 text-muted">{attachment.errorMessage ?? `${attachment.progress}% · ${(attachment.size / 1024).toFixed(1)} KB`}</p>
                  </div>
                ))}
              </div>
            </section>
          </section>

          <section className="flex flex-col gap-3 rounded-[24px] border border-line/80 bg-canvas/62 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="rounded-full border border-line/70 px-2.5 py-1 font-mono uppercase tracking-[0.18em]">Ctrl / Cmd + Enter 发送</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button aria-keyshortcuts="Control+S Meta+S" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-line/80 bg-panel/84 px-4 py-3 text-sm font-medium text-ink transition hover:border-accent/50 hover:text-accent sm:flex-none" data-testid="compose-save-close" onClick={() => { void saveDraftAndClose(); }} type="button">
                暂存并关闭
              </button>
              <button aria-keyshortcuts="Control+Enter Meta+Enter" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-accent/40 bg-accent px-4 py-3 text-sm font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none" data-testid="compose-send" disabled={isSending} onClick={() => { void handleSend(); }} type="button">
                {isSending ? '发送中…' : '发送'}
              </button>
            </div>
          </section>
        </form>
      )}
    </div>
  );
}
