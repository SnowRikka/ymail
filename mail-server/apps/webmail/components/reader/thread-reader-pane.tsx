'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MailActionStrip } from '@/components/actions/mail-action-strip';
import { useMailShellContext } from '@/components/mail/mail-shell';
import { useToast } from '@/components/system/toast-region';
import { buildComposeRouteHref } from '@/lib/jmap/compose-core';
import { applyOptimisticActionToReaderThread, executeMailAction, isDeleteOnlyMailboxRole, resolveMailboxRoleTargets, shouldHideSpamActionForMailboxRole, syncMailActionQueries, toReaderMailActionThreadRef, type MailActionRequest } from '@/lib/jmap/mail-actions';
import type { MailboxNavigationItem } from '@/lib/jmap/mailbox-shell';
import { queryReaderThread, type ReaderAttachment, type ReaderMessage, type ReaderParticipant, type ReaderThread } from '@/lib/jmap/message-reader';
import { toMailboxAccountOptions } from '@/lib/jmap/mailbox-shell';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';
import { getQueryClient } from '@/lib/query/client';
import { THREAD_LIST_ROUTE_PARAM_THREAD_ID } from '@/lib/jmap/thread-list';
import { sanitizeHtml } from '@/lib/sanitize/html';

export type ReaderPaneState =
  | {
      readonly kind: 'empty';
    }
  | {
      readonly kind: 'loading';
      readonly threadId: string;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly threadId: string;
    }
  | {
      readonly kind: 'not-found';
      readonly threadId: string;
    }
  | {
      readonly kind: 'ready';
      readonly thread: ReaderThread;
    };

const REMOTE_IMAGE_STORAGE_PREFIX = 'webmail.remote-images.';

function clearThreadSelectionHref(pathname: string, searchParams: URLSearchParams) {
  const nextParams = new URLSearchParams(searchParams.toString());
  nextParams.delete(THREAD_LIST_ROUTE_PARAM_THREAD_ID);
  const query = nextParams.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

function resolveCurrentMailboxId(pathname: string, searchParams: URLSearchParams, mailboxItems: readonly MailboxNavigationItem[], roleTargets: ReturnType<typeof resolveMailboxRoleTargets>) {
  const queryMailboxId = searchParams.get('mailboxId');
  if (queryMailboxId && mailboxItems.some((mailbox) => mailbox.id === queryMailboxId)) {
    return queryMailboxId;
  }

  if (pathname === '/mail/inbox') {
    return roleTargets.inboxId;
  }

  const dynamicPrefix = '/mail/mailbox/';
  if (pathname.startsWith(dynamicPrefix)) {
    const mailboxId = decodeURIComponent(pathname.slice(dynamicPrefix.length));
    return mailboxItems.find((mailbox) => mailbox.id === mailboxId)?.id ?? null;
  }

  return null;
}

function resolveActiveAccountId(searchParams: URLSearchParams, threadSession: ReturnType<typeof useJmapBootstrap>['data']) {
  if (threadSession?.status !== 'ready') {
    return null;
  }

  const accountIdFromUrl = searchParams.get('accountId');
  const accountOptions = toMailboxAccountOptions(threadSession.session);
  return accountOptions.find((account) => account.id === accountIdFromUrl)?.id ?? threadSession.session.primaryAccounts.mail ?? accountOptions[0]?.id ?? null;
}

function formatDateTime(value: string | null) {
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

function formatParticipants(participants: readonly ReaderParticipant[]) {
  return participants.length > 0 ? participants.map((participant) => participant.label).join('、') : '未填写';
}

function formatBytes(size: number | null) {
  if (size === null || size <= 0) {
    return '大小未知';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function splitQuotedPlainText(value: string) {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  const quotedStart = lines.findIndex((line, index) => index > 0 && (/^\s*>/.test(line) || /^On .+wrote:$/i.test(line.trim())));

  if (quotedStart <= 0) {
    return {
      main: value.trim(),
      quoted: null,
    };
  }

  const main = lines.slice(0, quotedStart).join('\n').trim();
  const quoted = lines.slice(quotedStart).join('\n').trim();

  return {
    main: main || value.trim(),
    quoted: quoted || null,
  };
}

function buildCidMap(message: ReaderMessage) {
  return Object.fromEntries(
    message.attachments
      .filter((attachment) => attachment.cid)
      .map((attachment) => [attachment.cid as string, attachment.openUrl]),
  );
}

function useRemoteImagesPreference(messageId: string) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setEnabled(window.sessionStorage.getItem(`${REMOTE_IMAGE_STORAGE_PREFIX}${messageId}`) === '1');
  }, [messageId]);

  const enable = () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(`${REMOTE_IMAGE_STORAGE_PREFIX}${messageId}`, '1');
    }

    setEnabled(true);
  };

  return { enable, enabled };
}

function HtmlMessageBody({ message }: { readonly message: ReaderMessage }) {
  const { enable, enabled } = useRemoteImagesPreference(message.id);
  const cidMap = useMemo(() => buildCidMap(message), [message]);
  const blockedResult = useMemo(() => sanitizeHtml(message.body.html ?? '', { cidMap }), [cidMap, message.body.html]);
  const enabledResult = useMemo(() => sanitizeHtml(message.body.html ?? '', { allowRemoteImages: true, cidMap }), [cidMap, message.body.html]);
  const activeResult = enabled ? enabledResult : blockedResult;

  if (activeResult.html.trim().length === 0) {
    return message.body.plainText ? <PlainTextBody value={message.body.plainText} /> : <BodyFallback />;
  }

  return (
    <div className="space-y-4">
      {blockedResult.blockedRemoteImages > 0 ? (
        <div aria-live="polite" className="flex flex-col gap-3 rounded-[18px] border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>已阻止 {blockedResult.blockedRemoteImages} 个远程图片请求，避免在阅读时泄露跟踪信息。</p>
          {enabled ? (
            <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">本次会话已允许</span>
          ) : (
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-accent/40 bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90"
              data-testid="remote-images-toggle"
              onClick={enable}
              type="button"
            >
              仅本次会话允许远程图片
            </button>
          )}
        </div>
      ) : null}

      <SanitizedHtmlBody html={activeResult.html} />
    </div>
  );
}

function SanitizedHtmlBody({ html }: { readonly html: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html;
    }
  }, [html]);

  return <div className="reader-html prose prose-invert max-w-none break-words text-sm leading-7 text-ink prose-a:text-accent prose-blockquote:border-line prose-blockquote:text-muted prose-code:text-accent prose-headings:text-ink prose-img:rounded-xl" ref={ref} />;
}

function PlainTextBody({ value }: { readonly value: string }) {
  const segments = splitQuotedPlainText(value);

  return (
    <div className="space-y-4 text-sm leading-7 text-ink">
      <div className="whitespace-pre-wrap break-words rounded-[20px] border border-line/70 bg-canvas/62 px-4 py-4">{segments.main}</div>
      {segments.quoted ? (
        <details className="rounded-[18px] border border-dashed border-line/70 bg-canvas/48 px-4 py-3 text-muted">
          <summary className="cursor-pointer list-none text-xs uppercase tracking-[0.22em] text-accent/80">显示引用内容</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-7">{segments.quoted}</pre>
        </details>
      ) : null}
    </div>
  );
}

function BodyFallback() {
  return <div className="rounded-[20px] border border-dashed border-line/70 bg-canvas/58 px-4 py-4 text-sm text-muted">这封邮件没有可展示的正文内容。</div>;
}

function MessageAttachments({ attachments }: { readonly attachments: readonly ReaderAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.28em] text-muted">附件</div>
      <ul aria-label="附件列表" className="grid gap-3">
        {attachments.map((attachment) => (
          <li className="rounded-[18px] border border-line/70 bg-canvas/58 px-4 py-4" data-testid={`attachment-item-${attachment.blobId}`} key={attachment.blobId}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{attachment.name}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                  <span>{attachment.contentType ?? '未知类型'}</span>
                  <span>·</span>
                  <span>{formatBytes(attachment.size)}</span>
                  {attachment.isInline ? (
                    <>
                      <span>·</span>
                      <span>内嵌</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link aria-label={`打开附件 ${attachment.name}`} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line/80 bg-panel/84 px-4 py-2 text-sm text-ink transition hover:border-accent/50 hover:text-accent" href={attachment.openUrl} target="_blank">
                  打开
                </Link>
                <Link aria-label={`下载附件 ${attachment.name}`} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-accent/40 bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90" href={attachment.downloadUrl}>
                  下载
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageMetadataRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</span>
      <span className="text-sm leading-6 text-ink">{value}</span>
    </div>
  );
}

function MessageCard({ index, message }: { readonly index: number; readonly message: ReaderMessage }) {
  const hasHtml = Boolean(message.body.html && message.body.html.trim().length > 0);
  const titleId = `message-title-${message.id}`;

  return (
    <article
      aria-labelledby={titleId}
      className="stage-reveal rounded-[24px] border border-line/80 bg-canvas/68 p-5"
      data-testid={`message-card-${message.id}`}
      style={{ ['--stage-delay' as string]: `${0.06 + index * 0.03}s` }}
    >
      <div className="flex flex-col gap-4 border-b border-line/70 pb-4">
        <div>
          <p className="text-lg font-semibold text-ink" id={titleId}>{message.subject}</p>
          <p className="mt-1 text-xs text-muted">{formatDateTime(message.receivedAt ?? message.sentAt)}</p>
        </div>

        <div className="space-y-2.5">
          <MessageMetadataRow label="发件人" value={formatParticipants(message.from.length > 0 ? message.from : message.sender)} />
          <MessageMetadataRow label="收件人" value={formatParticipants(message.to)} />
          {message.cc.length > 0 ? <MessageMetadataRow label="抄送" value={formatParticipants(message.cc)} /> : null}
          {message.bcc.length > 0 ? <MessageMetadataRow label="密送" value={formatParticipants(message.bcc)} /> : null}
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {hasHtml ? <HtmlMessageBody message={message} /> : message.body.plainText ? <PlainTextBody value={message.body.plainText} /> : <BodyFallback />}
        <MessageAttachments attachments={message.attachments} />
      </div>
    </article>
  );
}

function ReaderStatePanel({ actions, eyebrow, title, children }: { readonly actions?: React.ReactNode; readonly children: React.ReactNode; readonly eyebrow: string; readonly title: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-line/70 bg-canvas/66 p-6">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-accent/80">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        {eyebrow}
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">{children}</p>
      {actions ? <div className="mt-5">{actions}</div> : null}
    </div>
  );
}

export interface ThreadReaderPaneProps {
  readonly mailboxItems?: readonly MailboxNavigationItem[];
}

export function ThreadReaderPane({ mailboxItems = [] }: ThreadReaderPaneProps) {
  const shellContext = useMailShellContext();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const client = useJmapClient();
  const queryClient = useMemo(() => getQueryClient(), []);
  const { notify } = useToast();
  const resolvedMailboxItems = mailboxItems.length > 0 ? mailboxItems : shellContext.mailboxItems;
  const bootstrapQuery = useJmapBootstrap(true);
  const threadId = searchParams.get(THREAD_LIST_ROUTE_PARAM_THREAD_ID);
  const activeAccountId = resolveActiveAccountId(searchParams, bootstrapQuery.data);
  const roleTargets = useMemo(() => resolveMailboxRoleTargets(resolvedMailboxItems), [resolvedMailboxItems]);
  const currentMailboxId = useMemo(() => resolveCurrentMailboxId(pathname, searchParams, resolvedMailboxItems, roleTargets), [pathname, resolvedMailboxItems, roleTargets, searchParams]);
  const [optimisticThread, setOptimisticThread] = useState<ReaderThread | null>(null);
  const [pendingAction, setPendingAction] = useState<MailActionRequest['type'] | null>(null);
  const autoReadThreadIdRef = useRef<string | null>(null);
  const previousThreadIdRef = useRef<string | null>(null);
  const rollbackThreadRef = useRef<ReaderThread | null>(null);
  const rollbackHrefRef = useRef<string | null>(null);

  const threadQuery = useQuery<ReaderThread | null>({
    enabled: Boolean(activeAccountId && threadId) && bootstrapQuery.data?.status === 'ready',
    queryFn: () => queryReaderThread({ accountId: activeAccountId as string, client, threadId: threadId as string }),
    queryKey: ['reader-thread', activeAccountId, threadId],
    staleTime: 1000 * 30,
  });

  const state: ReaderPaneState = useMemo(() => {
    if (!threadId) {
      return { kind: 'empty' };
    }

    if (bootstrapQuery.isLoading || threadQuery.isLoading) {
      return { kind: 'loading', threadId };
    }

    if (threadQuery.isError) {
      return {
        kind: 'error',
        message: threadQuery.error instanceof Error ? threadQuery.error.message : '线程读取失败。',
        threadId,
      };
    }

    if (!threadQuery.data) {
      return { kind: 'not-found', threadId };
    }

    return {
      kind: 'ready',
      thread: threadQuery.data,
    };
  }, [bootstrapQuery.isLoading, threadId, threadQuery.data, threadQuery.error, threadQuery.isError, threadQuery.isLoading]);

  const displayedThread = state.kind === 'ready' ? optimisticThread ?? state.thread : null;
  const currentRoute = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname;

  useEffect(() => {
    if (previousThreadIdRef.current === threadId) {
      return;
    }

    previousThreadIdRef.current = threadId;
    autoReadThreadIdRef.current = null;
  }, [threadId]);

  const handleThreadAction = useCallback(async (action: MailActionRequest) => {
    if (pendingAction || !displayedThread) {
      return;
    }

    const optimisticResult = applyOptimisticActionToReaderThread({ action, thread: displayedThread });
    rollbackThreadRef.current = displayedThread;
    rollbackHrefRef.current = currentRoute;
    setPendingAction(action.type);

    if (optimisticResult.thread) {
      setOptimisticThread(optimisticResult.thread);
    }

    const result = await executeMailAction({
      accountId: displayedThread.accountId,
      action,
      client,
      currentMailboxId: currentMailboxId ?? roleTargets.inboxId ?? '',
      roleTargets,
      threads: [toReaderMailActionThreadRef(displayedThread)],
    });

    if (result.kind === 'failure') {
      setOptimisticThread(null);
      if (rollbackHrefRef.current && rollbackHrefRef.current !== currentRoute) {
        router.replace(rollbackHrefRef.current);
      }
      notify(result.message);
      setPendingAction(null);
      rollbackThreadRef.current = null;
      rollbackHrefRef.current = null;
      return;
    }

    setPendingAction(null);
    if (!optimisticResult.thread) {
      await syncMailActionQueries({
        accountId: displayedThread.accountId,
        currentMailboxId,
        queryClient,
      });
      setOptimisticThread(null);
      router.replace(clearThreadSelectionHref(pathname, searchParams));
    } else {
      await threadQuery.refetch();
      setOptimisticThread(null);
    }
    rollbackThreadRef.current = null;
    rollbackHrefRef.current = null;
    router.refresh();
  }, [client, currentMailboxId, currentRoute, displayedThread, notify, pathname, pendingAction, queryClient, roleTargets, router, searchParams, threadQuery]);

  useEffect(() => {
    if (!displayedThread || pendingAction || !displayedThread.isUnread) {
      return;
    }

    if (autoReadThreadIdRef.current === displayedThread.id) {
      return;
    }

    autoReadThreadIdRef.current = displayedThread.id;
    void handleThreadAction({ type: 'mark-read' });
  }, [displayedThread, handleThreadAction, pendingAction]);

  if (state.kind === 'empty') {
    return (
      <ReaderStatePanel eyebrow="等待阅读" title="选择一个邮件开始阅读">{null}</ReaderStatePanel>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" className="space-y-3">
        <div className="loading-shimmer h-20 rounded-[20px] border border-line/70 bg-canvas/55" />
        <div className="loading-shimmer h-48 rounded-[24px] border border-line/70 bg-canvas/55" />
        <div className="loading-shimmer h-40 rounded-[24px] border border-line/70 bg-canvas/55" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <ReaderStatePanel eyebrow="阅读异常" title={state.message}>
        当前线程的消息详情尚未成功返回，阅读器保持稳定布局，等待你重新选择或稍后重试。
      </ReaderStatePanel>
    );
  }

  if (state.kind === 'not-found') {
    return (
      <ReaderStatePanel eyebrow="线程不可用" title="所选线程已不存在或无法访问">
        当前地址仍指向线程 <span className="font-mono text-ink">{state.threadId}</span>，但此消息已无法访问。可以返回左侧列表重新选择线程。
      </ReaderStatePanel>
    );
  }

  if (!displayedThread) {
    return null;
  }

  const latestMessage = displayedThread.messages[displayedThread.messages.length - 1];
  const composeReplyHref = buildComposeRouteHref({
    accountId: displayedThread.accountId,
    intent: 'reply',
    messageId: latestMessage.id,
    returnTo: currentRoute,
    threadId: displayedThread.id,
  });
  const composeForwardHref = buildComposeRouteHref({
    accountId: displayedThread.accountId,
    intent: 'forward',
    messageId: latestMessage.id,
    returnTo: currentRoute,
    threadId: displayedThread.id,
  });

  const readerCanMove = currentMailboxId !== null && roleTargets.archiveId !== null;
  const readerCanDelete = currentMailboxId !== null && roleTargets.trashId !== null;
  const readerCanSpam = currentMailboxId !== null && roleTargets.junkId !== null;
  const currentMailboxRole = resolvedMailboxItems.find((mailbox) => mailbox.id === currentMailboxId)?.role ?? null;
  const deleteOnlyReaderActions = isDeleteOnlyMailboxRole(currentMailboxRole);
  const hideReadReaderAction = deleteOnlyReaderActions || currentMailboxRole === 'archive';
  const hideSpamReaderAction = shouldHideSpamActionForMailboxRole(currentMailboxRole);
  const readerActionVisibility = deleteOnlyReaderActions
    ? { archive: false, markRead: false, spam: false, star: false }
    : hideReadReaderAction || hideSpamReaderAction
      ? {
          ...(hideReadReaderAction ? { markRead: false } : {}),
          ...(hideSpamReaderAction ? { spam: false } : {}),
        }
      : undefined;

  return (
    <div className="space-y-4">
      <div className="rounded-[22px] border border-line/70 bg-canvas/72 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-ink">{displayedThread.subject}</h2>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <MailActionStrip
              availability={{ archive: readerCanMove, delete: readerCanDelete, spam: readerCanSpam }}
              disabled={pendingAction !== null}
              onAction={handleThreadAction}
              readAction={displayedThread.isUnread ? { type: 'mark-read' } : { type: 'mark-unread' }}
              readLabel={displayedThread.isUnread ? '已读' : '未读'}
              starAction={displayedThread.isFlagged ? { type: 'unstar' } : { type: 'star' }}
              starLabel={displayedThread.isFlagged ? '取消星标' : '加星'}
              testIdPrefix="reader"
              visibility={readerActionVisibility}
            />
            {deleteOnlyReaderActions ? null : (
              <div className="flex flex-wrap gap-2">
                <Link aria-label="回复当前线程" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-line/80 bg-panel/84 px-4 py-2 text-sm text-ink transition hover:border-accent/50 hover:text-accent" data-testid="reader-reply" href={composeReplyHref}>
                  回复
                </Link>
                <Link aria-label="转发当前线程" className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-accent/40 bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90" data-testid="reader-forward" href={composeForwardHref}>
                  转发
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {displayedThread.messages.map((message, index) => (
          <MessageCard index={index} key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
