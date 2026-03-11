'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <main className="shell-surface w-full max-w-xl rounded-[32px] border border-line/70 px-10 py-12 shadow-shell">
          <p className="font-serif text-sm uppercase tracking-[0.32em] text-accent">系统错误</p>
          <h1 className="mt-4 text-3xl font-semibold">暂时无法打开邮箱壳层</h1>
          <p className="mt-4 text-sm ink-muted">{error.message || '请稍后重试。'}</p>
          <button
            className="mt-8 rounded-full bg-accent px-5 py-3 text-sm font-medium text-white"
            onClick={reset}
            type="button"
          >
            重新加载
          </button>
        </main>
      </body>
    </html>
  );
}
