import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadReaderPane } from '@/components/reader/thread-reader-pane';
import { ToastProvider } from '@/components/system/toast-region';
import { useJmapBootstrap, useJmapClient } from '@/lib/jmap/provider';

const mockRouter = {
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
};

let mockSearchParams = new URLSearchParams('accountId=primary&threadId=thread-1');

vi.mock('next/navigation', () => ({
  usePathname: () => '/mail/inbox',
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock('@/lib/jmap/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jmap/provider')>('@/lib/jmap/provider');

  return {
    ...actual,
    useJmapBootstrap: vi.fn(),
    useJmapClient: vi.fn(),
  };
});

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseJmapBootstrap = vi.mocked(useJmapBootstrap);
const mockedUseJmapClient = vi.mocked(useJmapClient);

function createReadyThread(overrides?: Partial<Parameters<typeof createMessage>[0]>) {
  return {
    accountId: 'primary',
    id: 'thread-1',
    messageCount: 1,
    messages: [createMessage(overrides)],
    subject: overrides?.subject ?? 'Reader subject',
  };
}

function createMessage(overrides?: Partial<{
  attachments: Array<{ blobId: string; contentType: string | null; disposition: string | null; downloadUrl: string; isInline: boolean; name: string; openUrl: string; size: number | null; cid: string | null }>;
  html: string | null;
  plainText: string | null;
  subject: string;
}>) {
  return {
    attachments: overrides?.attachments ?? [],
    bcc: [],
    body: {
      html: overrides?.html ?? null,
      plainText: overrides?.plainText ?? 'Fallback text body',
    },
    cc: [],
    from: [{ email: 'alice@example.com', label: 'Alice', name: 'Alice' }],
    id: 'message-1',
    preview: 'Preview',
    receivedAt: '2026-03-10T10:00:00.000Z',
    replyTo: [],
    sender: [],
    sentAt: '2026-03-10T10:00:00.000Z',
    subject: overrides?.subject ?? 'Reader subject',
    threadId: 'thread-1',
    to: [{ email: 'team@example.com', label: 'Team', name: 'Team' }],
  };
}

beforeEach(() => {
  mockSearchParams = new URLSearchParams('accountId=primary&threadId=thread-1');
  mockRouter.push.mockReset();
  mockRouter.refresh.mockReset();
  mockRouter.replace.mockReset();
  mockedUseJmapClient.mockReturnValue({} as never);
  mockedUseJmapBootstrap.mockReturnValue({
    data: {
      session: {
        accounts: {
          primary: {
            accountCapabilities: {
              mail: { key: 'mail', supported: true, urn: 'urn:ietf:params:jmap:mail', value: { emailQuerySortOptions: ['receivedAt'], maxMailboxDepth: 10, maxMailboxesPerEmail: null, maxSizeAttachmentsPerEmail: 1, maxSizeMailboxName: 255, mayCreateTopLevelMailbox: true } },
            },
            id: 'primary',
            isPersonal: true,
            isReadOnly: false,
            name: 'Primary',
          },
        },
        primaryAccounts: { blob: null, mail: 'primary', quota: null, sieve: null, submission: null },
      },
      status: 'ready',
    },
    isLoading: false,
    } as never);
    mockedUseQuery.mockReset();
  window.sessionStorage.clear();
});

describe('message-reader', () => {
  function renderPane() {
    return render(
      <ToastProvider>
        <ThreadReaderPane />
      </ToastProvider>,
    );
  }

  it('renders plaintext fallback when html is absent', () => {
    mockedUseQuery.mockReturnValue({
      data: createReadyThread({ html: null, plainText: 'Hello plain text' }),
      isError: false,
      isLoading: false,
    } as never);

    renderPane();

    expect(screen.getByTestId('message-card-message-1')).toBeInTheDocument();
    expect(screen.getByText('Hello plain text')).toBeInTheDocument();
    expect(screen.queryByText('第 1 封')).not.toBeInTheDocument();
  });

  it('keeps the empty reader panel mounted without explanatory copy', () => {
    mockSearchParams = new URLSearchParams('accountId=primary');
    mockedUseQuery.mockReturnValue({
      data: null,
      isError: false,
      isLoading: false,
    } as never);

    renderPane();

    expect(screen.getByText('选择一个邮件开始阅读')).toBeInTheDocument();
    expect(screen.queryByText('左侧线程列表已经和路由状态同步。选择任意线程后，这里会按时间顺序展示消息元数据、正文与附件。')).not.toBeInTheDocument();
  });

  it('renders sanitized html and blocks remote images by default', () => {
    mockedUseQuery.mockReturnValue({
      data: createReadyThread({ html: '<p>Safe body</p><img src="https://cdn.example/pixel.png"><script>alert(1)</script>', plainText: null }),
      isError: false,
      isLoading: false,
    } as never);

    renderPane();

    expect(screen.getByText('Safe body')).toBeInTheDocument();
    expect(screen.getByTestId('remote-images-toggle')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('[data-remote-image-blocked="true"]')).not.toBeNull();
  });

  it('enables remote images for the current session only after opt-in', () => {
    mockedUseQuery.mockReturnValue({
      data: createReadyThread({ html: '<p>Safe body</p><img src="https://cdn.example/pixel.png">', plainText: null }),
      isError: false,
      isLoading: false,
    } as never);

    renderPane();

    fireEvent.click(screen.getByTestId('remote-images-toggle'));

    const image = document.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example/pixel.png');
    expect(window.sessionStorage.getItem('webmail.remote-images.message-1')).toBe('1');
  });

  it('renders attachment metadata with same-origin open and download urls', () => {
    mockedUseQuery.mockReturnValue({
      data: createReadyThread({
        attachments: [
          {
            blobId: 'blob-1',
            cid: null,
            contentType: 'application/pdf',
            disposition: 'attachment',
            downloadUrl: '/api/jmap/download/primary/blob-1?download=1',
            isInline: false,
            name: 'report.pdf',
            openUrl: '/api/jmap/download/primary/blob-1',
            size: 1024,
          },
        ],
      }),
      isError: false,
      isLoading: false,
    } as never);

    renderPane();

    const attachment = screen.getByTestId('attachment-item-blob-1');
    expect(attachment).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '打开附件 report.pdf' })).toHaveAttribute('href', '/api/jmap/download/primary/blob-1');
    expect(screen.getByRole('link', { name: '下载附件 report.pdf' })).toHaveAttribute('href', '/api/jmap/download/primary/blob-1?download=1');
  });
});
