import { MailShell } from '@/components/mail/mail-shell';
import { getServerSessionSummary } from '@/lib/auth/session';

export default async function PreferencesPage() {
  const sessionSummary = await getServerSessionSummary();

  return (
    <MailShell
      eyebrow="偏好设置"
      intro="偏好页只保留阅读相关默认项，继续沿用黑曜工作台层级，不扩展新的产品域。"
      readerTitle="阅读与通知偏好"
      sectionTitle="设置分组"
      sessionSummary={sessionSummary}
    >
      <section className="space-y-4 rounded-[28px] border border-line/80 bg-panel/90 p-6">
        <div className="flex flex-col gap-3 rounded-2xl border border-line/70 bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">优先打开收件箱</p>
            <p className="mt-1 text-xs text-muted">登录后直接进入收件箱视图。</p>
          </div>
          <span className="rounded-full border border-accent/20 bg-accent/12 px-3 py-1 text-xs font-medium text-accent">默认开启</span>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-line/70 bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">外部图片保护</p>
            <p className="mt-1 text-xs text-muted">默认阻止远程图片，仅在当前阅读会话中按邮件临时允许。</p>
          </div>
          <span className="rounded-full border border-accent/20 bg-accent/12 px-3 py-1 text-xs font-medium text-accent">默认保护</span>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-line/70 bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">减少动态效果</p>
            <p className="mt-1 text-xs text-muted">跟随系统“减少动态效果”偏好，关闭入场动画与过渡。</p>
          </div>
          <span className="rounded-full border border-accent/20 bg-accent/12 px-3 py-1 text-xs font-medium text-accent">跟随系统</span>
        </div>
      </section>
    </MailShell>
  );
}
