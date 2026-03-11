import { LoginForm } from '@/components/mail/login-form';

type LoginCardProps = {
  nextPath: string;
};

export function LoginCard({ nextPath }: LoginCardProps) {
  return (
    <section className="shell-surface grid w-full max-w-5xl overflow-hidden rounded-[36px] border border-line/70 shadow-shell lg:grid-cols-[1.1fr_0.9fr]">
      <div className="bg-[linear-gradient(150deg,rgba(15,57,91,0.96),rgba(14,116,144,0.88))] px-8 py-10 text-white sm:px-12 sm:py-14">
        <p className="font-serif text-sm uppercase tracking-[0.36em] text-white/70">Stalwart Webmail</p>
        <h1 className="mt-6 max-w-md text-4xl font-semibold leading-tight sm:text-5xl">
          为中文阅读场景设计的轻盈邮箱壳层
        </h1>
        <p className="mt-6 max-w-lg text-sm leading-7 text-white/76 sm:text-base">
          登录后只会在当前浏览器保留安全会话，收件箱、搜索、阅读与写信都延续同一套受保护工作台体验。
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur">
            <MailIcon className="h-5 w-5" />
            <p className="mt-4 text-sm font-medium">三栏阅读骨架</p>
            <p className="mt-2 text-sm text-white/70">邮箱树、线程列表、阅读面板继续复用同一受保护壳层。</p>
          </div>
          <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur">
            <LockIcon className="h-5 w-5" />
            <p className="mt-4 text-sm font-medium">浏览器安全会话</p>
            <p className="mt-2 text-sm text-white/70">未认证或过期访问 `/mail/*` 会立即失效并回到登录页。</p>
          </div>
        </div>
      </div>

      <div className="bg-panel px-8 py-10 sm:px-12 sm:py-14">
        <LoginForm nextPath={nextPath} />
      </div>
    </section>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5 8 6.116 4.282a1.5 1.5 0 0 0 1.768 0L19 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <rect height="9" rx="2" stroke="currentColor" strokeWidth="1.5" width="12" x="6" y="11" />
      <path d="M8.5 11V8.5a3.5 3.5 0 1 1 7 0V11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="12" cy="15.5" fill="currentColor" r="1" />
    </svg>
  );
}
