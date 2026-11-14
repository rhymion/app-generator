'use client';

import { createContext, useContext, useState } from 'react';

/**
 * Makes the Content Security Policy nonce of the current document available to client
 * components that render their own inline `<style>` or `<script>` outside Emotion, such as
 * MUI X DataGrid (its `nonce` prop). The root layout reads the nonce that proxy.ts set for
 * the request and passes it here. See docs/knowledge/content-security-policy.md.
 */
const CspNonceContext = createContext<string | undefined>(undefined);

export function CspNonceProvider({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  // The browser checks inline elements against the policy that came with the first document
  // load. A later server re-render (router.refresh(), a server action) carries a fresh nonce
  // that the document's policy does not know, so keep the first value.
  const [documentNonce] = useState(nonce);
  return <CspNonceContext.Provider value={documentNonce}>{children}</CspNonceContext.Provider>;
}

/** The document's CSP nonce, or undefined outside a `CspNonceProvider` (tests, pages without the proxy). */
export function useCspNonce(): string | undefined {
  return useContext(CspNonceContext);
}
