import { MailShell } from '@/components/mail/mail-shell';
import { ThreadReaderPane } from '@/components/reader/thread-reader-pane';
import { getServerSessionSummary } from '@/lib/auth/session';

export default async function InboxPage() {
  const sessionSummary = await getServerSessionSummary();

  return (
    <MailShell
      eyebrow="收件箱"
      intro="桌面端保持三栏阅读节奏，移动端则依次聚焦线程列表、阅读器与邮箱导航，始终维持同一套黑曜工作台体验。"
      readerTitle="邮箱工作台"
      sectionTitle="活动邮箱"
      sessionSummary={sessionSummary}
    >
      <ThreadReaderPane />
    </MailShell>
  );
}
