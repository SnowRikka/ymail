import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="shell-surface w-full max-w-xl rounded-[32px] border border-line/70 px-10 py-12 text-center shadow-shell">
        <p className="font-serif text-sm uppercase tracking-[0.32em] text-accent">路由未命中</p>
        <h1 className="mt-4 text-4xl font-semibold text-ink">页面不存在</h1>
        <Link
          className="mt-8 inline-flex rounded-full bg-accent px-5 py-3 text-sm font-medium text-white"
          href="/login"
        >
          返回登录
        </Link>
      </section>
    </main>
  );
}
