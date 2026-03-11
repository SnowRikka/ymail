import { ComposeForm } from '@/components/compose/compose-form';
import { MailShell } from '@/components/mail/mail-shell';
import { getServerSessionSummary } from '@/lib/auth/session';

export default async function ComposePage() {
  const sessionSummary = await getServerSessionSummary();

  return (
    <MailShell
      eyebrow="写信"
      intro="写信页保持纯文本工作流，可从新建、回复、全部回复或转发进入，并提供快捷键、暂存与失败恢复。"
      readerTitle="写信工作台"
      sectionTitle="草稿上下文"
      sessionSummary={sessionSummary}
    >
      <ComposeForm sessionSummary={sessionSummary} />
    </MailShell>
  );
}
