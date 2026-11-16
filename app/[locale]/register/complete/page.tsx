import type { Metadata } from "next";
import { Suspense } from "react";
import RegisterCompleteForm from "./RegisterCompleteForm";

// Second step of self-registration with email verification (Issue #1092),
// opened from the emailed link. The link's token is in the query string, so
// the page sends no Referer header: a link followed from here (the legal
// pages) must not carry the token to another URL.
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function RegisterCompletePage() {
  return (
    <Suspense>
      <RegisterCompleteForm />
    </Suspense>
  );
}
