import { MailShell } from '@/components/mail/mail-shell';
import { ThreadReaderPane } from '@/components/reader/thread-reader-pane';
import { getServerSessionSummary } from '@/lib/auth/session';

export default async function InboxPage() {
  const sessionSummary = await getServerSessionSummary();

  return (
    <MailShell
      eyebrow="收件箱"
      intro="桌面端保持三栏阅读节奏，移动端依次聚焦线程列表、阅读器与系统邮箱。"
      readerTitle="邮件"
      sectionTitle=""
      sessionSummary={sessionSummary}
    >
      <ThreadReaderPane />
    </MailShell>
  );
}
