import type { Metadata } from "next";
import { Suspense } from "react";
import CancelEmailChangeForm from "./CancelEmailChangeForm";

// Cancels a pending email change, opened from the link in the notice mailed to the current
// address. The token is in the query string, so the page sends no Referer header.
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function CancelEmailChangePage() {
  return (
    <Suspense>
      <CancelEmailChangeForm />
    </Suspense>
  );
}
