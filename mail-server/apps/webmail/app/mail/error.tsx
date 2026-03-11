'use client';

import { ErrorState } from '@/components/system/error-state';

export default function MailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <ErrorState
        actionLabel="重新打开邮箱"
        description={error.message || '邮箱布局加载失败。'}
        onAction={reset}
        title="邮件界面暂时不可用"
      />
    </main>
  );
}
