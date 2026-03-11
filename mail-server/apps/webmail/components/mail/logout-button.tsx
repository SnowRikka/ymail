'use client';

import { useState } from 'react';

export function LogoutButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    setIsSubmitting(true);

    try {
      await fetch('/auth/logout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <button
      className="rounded-full border border-line bg-panel px-4 py-2 text-sm text-ink transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-70"
      data-testid="logout-button"
      disabled={isSubmitting}
      onClick={handleLogout}
      type="button"
    >
      {isSubmitting ? '退出中…' : '退出登录'}
    </button>
  );
}
