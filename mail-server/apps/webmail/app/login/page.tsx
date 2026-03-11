import { redirect } from 'next/navigation';

import { LoginCard } from '@/components/mail/login-card';
import { sanitizeNextPath } from '@/lib/auth/guard';
import { hasServerSession } from '@/lib/auth/session';

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await hasServerSession()) {
    redirect('/mail/inbox');
  }

  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <LoginCard nextPath={sanitizeNextPath(params.next)} />
    </main>
  );
}
