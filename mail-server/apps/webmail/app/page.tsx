import { redirect } from 'next/navigation';

import { hasServerSession } from '@/lib/auth/session';

export default async function HomePage() {
  redirect((await hasServerSession()) ? '/mail/inbox' : '/login');
}
