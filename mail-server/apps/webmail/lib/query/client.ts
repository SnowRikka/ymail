'use client';

import { QueryClient } from '@tanstack/react-query';

let client: QueryClient | undefined;

export function getQueryClient() {
  if (!client) {
    client = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 1000 * 60 * 10,
          refetchOnWindowFocus: false,
          retry: 1,
          staleTime: 1000 * 30,
        },
      },
    });
  }

  return client;
}
