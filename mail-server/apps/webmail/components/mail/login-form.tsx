'use client';

import { useState } from 'react';

type LoginFormProps = {
  nextPath: string;
};

type LoginResponse = {
  message?: string;
  redirectTo?: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);

    const response = await fetch('/auth/login', {
      body: JSON.stringify({
        next: nextPath,
        password: formData.get('password'),
        username: formData.get('username'),
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).catch(() => null);

    if (!response) {
      setErrorMessage('暂时无法连接登录服务，请稍后重试。');
      setIsSubmitting(false);
      return;
    }

    const payload = ((await response.json().catch(() => ({}))) as LoginResponse) ?? {};

    if (!response.ok) {
      setErrorMessage(payload.message ?? '登录失败，请检查输入后重试。');
      setIsSubmitting(false);
      return;
    }

    window.location.assign(payload.redirectTo ?? nextPath);
  }

  return (
    <form className="mx-auto max-w-md space-y-5" data-testid="login-form" onSubmit={handleSubmit}>
      <div>
        <p className="font-serif text-sm uppercase tracking-[0.32em] text-accent">账户入口</p>
        <h2 className="mt-4 text-3xl font-semibold text-ink">登录到你的邮箱</h2>
        <p className="mt-3 text-sm leading-7 ink-muted">浏览器只会保存安全会话标识，登录信息不会直接暴露在页面脚本中。</p>
      </div>

      <label className="block text-sm text-ink">
        邮箱地址
        <input
          autoComplete="username"
          className="mt-2 w-full rounded-2xl border border-line bg-canvas px-4 py-3 outline-none ring-accent/20 transition focus:ring-4"
          name="username"
          placeholder="例如：me@example.com"
          type="email"
        />
      </label>
      <label className="block text-sm text-ink">
        登录密码
        <input
          autoComplete="current-password"
          className="mt-2 w-full rounded-2xl border border-line bg-canvas px-4 py-3 outline-none ring-accent/20 transition focus:ring-4"
          name="password"
          placeholder="输入密码以继续"
          type="password"
        />
      </label>

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <button
        className="w-full rounded-full bg-accent px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
        data-testid="login-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? '登录中…' : '继续登录'}
      </button>
    </form>
  );
}
