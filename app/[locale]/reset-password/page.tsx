import type { Metadata } from "next";
import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

// Password reset, step 2 (Issue #1282), opened from the emailed link. The token is in the
// query string, so the page sends no Referer header.
export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
