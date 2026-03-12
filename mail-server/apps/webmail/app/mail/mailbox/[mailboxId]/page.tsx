import { MailShell } from '@/components/mail/mail-shell';
import { ThreadReaderPane } from '@/components/reader/thread-reader-pane';
import { getServerSessionSummary } from '@/lib/auth/session';

export default async function MailboxPage({
  params,
}: {
  params: Promise<{ mailboxId: string }>;
  searchParams: Promise<{ threadId?: string | string[] }>;
}) {
  const [{ mailboxId }, sessionSummary] = await Promise.all([params, getServerSessionSummary()]);

  return (
    <MailShell
      eyebrow="邮箱"
      intro="左侧保留系统邮箱切换，中间浏览线程，右侧稳定阅读正文与附件。"
      readerTitle="邮件"
      sectionTitle="文件夹"
      sessionSummary={sessionSummary}
    >
      <ThreadReaderPane key={mailboxId} />
    </MailShell>
  );
}
