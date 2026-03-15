import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ComposeDraftRecord } from '@/lib/jmap/compose-core';

export interface ComposeDraftStore {
  readonly drafts: Readonly<Record<string, ComposeDraftRecord>>;
  clearDraft: (draftKey: string) => void;
  clearDraftAliases: (input: { readonly draftKey: string; readonly serverDraftId: string | null }) => void;
  saveDraft: (draftKey: string, draft: ComposeDraftRecord) => void;
}

export const COMPOSE_DRAFT_STORAGE_KEY = 'webmail.compose-drafts';

const composeDraftStorage = createJSONStorage<Pick<ComposeDraftStore, 'drafts'>>(() => {
  if (typeof window === 'undefined') {
    return {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => undefined,
    };
  }

  return window.localStorage;
});

export const useComposeDraftStore = create<ComposeDraftStore>()(persist(
  (set) => ({
    clearDraft: (draftKey) => set((state) => {
      const nextDrafts = { ...state.drafts };
      delete nextDrafts[draftKey];

      return {
        drafts: nextDrafts,
      };
    }),
    clearDraftAliases: ({ draftKey, serverDraftId }) => set((state) => {
      const nextDrafts = Object.fromEntries(
        Object.entries(state.drafts).filter(([entryKey, draft]) => entryKey !== draftKey && (!serverDraftId || draft.serverDraftId !== serverDraftId)),
      );

      return {
        drafts: nextDrafts,
      };
    }),
    drafts: {},
    saveDraft: (draftKey, draft) => set((state) => ({
      drafts: {
        ...state.drafts,
        [draftKey]: draft,
      },
    })),
  }),
  {
    name: COMPOSE_DRAFT_STORAGE_KEY,
    partialize: (state) => ({ drafts: state.drafts }),
    storage: composeDraftStorage,
  },
));
