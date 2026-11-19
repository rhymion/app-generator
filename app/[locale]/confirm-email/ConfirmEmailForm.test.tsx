import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import ConfirmEmailForm from "./ConfirmEmailForm";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const search = { value: "token=abc123" };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

vi.mock("next-intl", () => {
  const messages: Record<string, string> = {
    confirmEmailTitle: "Confirm your new email address",
    confirmEmailHelper: "Select the button to use this address.",
    confirmEmailButton: "Confirm email address",
    confirmEmailDone: "Your email address has been changed.",
    confirmEmailLinkInvalid: "This confirmation link cannot be used.",
    confirmEmailTaken: "This address is already used by another account.",
    confirmEmailNotAllowed: "This address can no longer be used.",
    confirmEmailFailed: "The email address could not be changed.",
    backToSignIn: "Back to sign in",
  };
  return { useTranslations: () => (key: string) => messages[key] ?? key, useLocale: () => "ja" };
});

function respond(status: number, body: object) {
  return vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
}

async function confirm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /confirm email address/i }));
}

describe("ConfirmEmailForm (Issue #1400)", () => {
  beforeEach(() => {
    search.value = "token=abc123";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("changes nothing until the button is pressed", () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<ConfirmEmailForm />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token and the locale, then confirms the change", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<ConfirmEmailForm />);
    await confirm();
    await waitFor(() => expect(screen.getByText("Your email address has been changed.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/email-change/complete", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "abc123", locale: "ja" });
  });

  it("explains an unusable link", async () => {
    vi.stubGlobal("fetch", respond(400, { code: "INVALID_TOKEN" }));
    render(<ConfirmEmailForm />);
    await confirm();
    await waitFor(() => expect(screen.getByText("This confirmation link cannot be used.")).toBeInTheDocument());
  });

  it("says when another account took the address", async () => {
    vi.stubGlobal("fetch", respond(409, { code: "EMAIL_TAKEN" }));
    render(<ConfirmEmailForm />);
    await confirm();
    await waitFor(() => expect(screen.getByText("This address is already used by another account.")).toBeInTheDocument());
  });

  it("says when the address left the domain allow-list (Issue #1402)", async () => {
    vi.stubGlobal("fetch", respond(403, { code: "EMAIL_NOT_ALLOWED" }));
    render(<ConfirmEmailForm />);
    await confirm();
    await waitFor(() => expect(screen.getByText("This address can no longer be used.")).toBeInTheDocument());
  });

  it("shows the link as unusable when it has no token", () => {
    search.value = "";
    render(<ConfirmEmailForm />);
    expect(screen.getByText("This confirmation link cannot be used.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
