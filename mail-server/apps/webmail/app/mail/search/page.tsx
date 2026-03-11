import { MailShell } from '@/components/mail/mail-shell';
import { ThreadReaderPane } from '@/components/reader/thread-reader-pane';
import { getServerSessionSummary } from '@/lib/auth/session';

export default async function SearchPage() {
  const sessionSummary = await getServerSessionSummary();

  return (
    <MailShell
      eyebrow="搜索"
      intro="搜索页沿用同一套黑曜三栏工作台：顶部输入与筛选保持当前条件，中间结果列表和右侧阅读器继续联动。"
      listPaneTestId="search-results"
      listPaneVariant="search"
      readerTitle="搜索工作台"
      sectionTitle="搜索结果"
      sessionSummary={sessionSummary}
    >
      <ThreadReaderPane />
    </MailShell>
  );
}
