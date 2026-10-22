'use client';

import { createContext, useContext } from 'react';

/**
 * Set while an entity's generated form is shown inside the "Create new" dialog of another
 * entity's foreign-key field (x-create-inline). The form then asks its save action for the
 * new id instead of redirecting, reports it through `onCreated`, and closes through
 * `onCancel` instead of navigating to the list.
 */
export interface InlineCreateContextValue {
  onCreated: (id: string) => void | Promise<void>;
  onCancel: () => void;
}

const InlineCreateContext = createContext<InlineCreateContextValue | null>(null);

export const InlineCreateProvider = InlineCreateContext.Provider;

/** The dialog context, or null when the form is shown on its own page. */
export function useInlineCreate(): InlineCreateContextValue | null {
  return useContext(InlineCreateContext);
}
