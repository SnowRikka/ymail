'use client';

import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';

import { createJmapClient } from '@/lib/jmap/client';
import type { JmapBootstrapResult, JmapClient } from '@/lib/jmap/types';
import { getQueryClient } from '@/lib/query/client';

const JmapClientContext = createContext<JmapClient | null>(null);

export function JmapClientProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => getQueryClient(), []);
  const client = useMemo(() => createJmapClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <JmapClientContext.Provider value={client}>{children}</JmapClientContext.Provider>
    </QueryClientProvider>
  );
}

export function useJmapClient() {
  const client = useContext(JmapClientContext);

  if (!client) {
    throw new Error('JmapClientProvider is required.');
  }

  return client;
}

export function useJmapBootstrap(enabled = true) {
  const client = useJmapClient();

  return useQuery<JmapBootstrapResult>({
    enabled,
    queryFn: () => client.bootstrap(),
    queryKey: ['jmap', 'session'],
    staleTime: 1000 * 60,
  });
}
