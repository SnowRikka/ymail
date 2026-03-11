import type { JmapSessionResource } from '@/lib/jmap/types';

export type SafeSessionSummary = {
  accountCount: number;
  expiresAt: string;
  username: string;
};

export type AuthSessionResponse =
  | {
      authenticated: false;
    }
  | {
      authenticated: true;
      jmap: JmapSessionResource;
      session: SafeSessionSummary;
    };
