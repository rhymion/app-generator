import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import ResetPasswordForm from "./ResetPasswordForm";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const search = { value: "token=abc123" };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

vi.mock("next-intl", () => {
  const messages: Record<string, string> = {
    resetPasswordTitle: "Choose a new password",
    passwordPlaceholder: "Password",
    confirmPasswordPlaceholder: "Confirm password",
    passwordMismatch: "Passwords do not match",
    resetPasswordButton: "Set new password",
    resetPasswordMfaHelper: "Enter your authentication code.",
    mfaCodeLabel: "6-digit authentication code",
    mfaInvalid: "That code did not match.",
    mfaRateLimited: "Too many attempts.",
    resetPasswordDone: "Your password has been changed.",
    resetPasswordLinkInvalid: "This reset link cannot be used.",
    resetPasswordStartAgain: "Request a new link",
    resetPasswordFailed: "The password could not be changed.",
    backToSignIn: "Back to sign in",
  };
  return { useTranslations: () => (key: string) => messages[key] ?? key };
});

function respond(status: number, body: object) {
  return vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
}

async function submit(password = "correct horse battery", confirm = password) {
  const user = userEvent.setup();
  await user.type(screen.getByTestId("password"), password);
  await user.type(screen.getByTestId("confirm-password"), confirm);
  await user.click(screen.getByRole("button", { name: /set new password/i }));
  return user;
}

describe("ResetPasswordForm (Issue #1282)", () => {
  beforeEach(() => {
    search.value = "token=abc123";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the token and the new password, then confirms the change", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm />);
    await submit();
    await waitFor(() => expect(screen.getByText("Your password has been changed.")).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/password-reset/complete");
    expect(JSON.parse(init.body)).toEqual({ token: "abc123", password: "correct horse battery" });
  });

  it("does not submit when the two passwords differ", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm />);
    await submit("correct horse battery", "something else");
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the authentication code when the account uses MFA and sends it on the next try", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ code: "MFA_REQUIRED" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetPasswordForm />);
    const user = await submit();
    const code = await screen.findByTestId("mfa-code");
    await user.type(code.querySelector("input") ?? code, "123456");
    await user.click(screen.getByRole("button", { name: /set new password/i }));
    await waitFor(() => expect(screen.getByText("Your password has been changed.")).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).mfaCode).toBe("123456");
  });

  it("shows the invalid-link state for a used or expired link, and without a token", async () => {
    vi.stubGlobal("fetch", respond(400, { code: "INVALID_TOKEN" }));
    const { unmount } = render(<ResetPasswordForm />);
    await submit();
    await waitFor(() => expect(screen.getByText("This reset link cannot be used.")).toBeInTheDocument());
    unmount();
    search.value = "";
    render(<ResetPasswordForm />);
    expect(screen.getByText("This reset link cannot be used.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });
});
