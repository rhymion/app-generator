import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, afterEach } from "vitest";
import { siteConfig } from "@/lib/site-config";
import ForgotPasswordPage from "./page";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock("next-intl", () => {
  const messages: Record<string, string> = {
    forgotPasswordTitle: "Reset your password",
    forgotPasswordNotice: "Enter the email address of your account.",
    emailPlaceholder: "Email address",
    forgotPasswordSend: "Send reset link",
    forgotPasswordCheckEmailBody: "If an account with a password uses this address, a message is on its way.",
    forgotPasswordFailed: "The reset link could not be requested.",
    backToSignIn: "Back to sign in",
  };
  return { useTranslations: () => (key: string) => messages[key] ?? key, useLocale: () => "en" };
});

const registration = siteConfig.auth.registration as { emailVerification: boolean };
const saved = registration.emailVerification;

describe("ForgotPasswordPage (Issue #1282)", () => {
  afterEach(() => {
    registration.emailVerification = saved;
    vi.unstubAllGlobals();
  });

  it("requests a link and then shows the same notice whatever the address", async () => {
    registration.emailVerification = true;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ForgotPasswordPage />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /email address/i }), "a@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByText(/a message is on its way/)).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/password-reset");
    expect(JSON.parse(init.body)).toEqual({ email: "a@example.com", locale: "en" });
  });

  it("shows an error when the request fails", async () => {
    registration.emailVerification = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<ForgotPasswordPage />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /email address/i }), "a@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByText("The reset link could not be requested.")).toBeInTheDocument());
  });

  it("offers no form while email verification is off", () => {
    registration.emailVerification = false;
    render(<ForgotPasswordPage />);
    expect(screen.queryByRole("button", { name: /send reset link/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });
});
