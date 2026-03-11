import { redirect } from 'next/navigation';

import { hasServerSession } from '@/lib/auth/session';

export default async function MailLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (!(await hasServerSession())) {
    redirect('/login?next=%2Fmail%2Finbox');
  }

  return children;
}
