import type { Metadata } from "next";
import { Suspense } from "react";
import ConfirmEmailForm from "./ConfirmEmailForm";

// Email change, step 2 (Issue #1400), opened from the link mailed to the new address. The token is
// in the query string, so the page sends no Referer header.
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailForm />
    </Suspense>
  );
}
