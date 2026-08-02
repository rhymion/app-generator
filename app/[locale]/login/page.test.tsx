import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "next-auth/react";
import LoginPage from "./page";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock @/i18n/navigation (used for the "no account? register" Link only —
// post-login navigation uses a plain window.location assignment, see below)
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// `redirect` query param read via next/navigation's useSearchParams —
// mutable per-test through mockSearchParamsGet.
const mockSearchParamsGet = vi.fn((_key: string) => null as string | null);
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

// Mock next-intl — return English strings matching messages/en.json
vi.mock("next-intl", () => ({
  useTranslations: (_namespace: string) => (key: string) => {
    const messages: Record<string, string> = {
      signInTitle: "Sign in to your account",
      emailPlaceholder: "Email address",
      passwordPlaceholder: "Password",
      signInButton: "Sign in",
      noAccount: "No account? Register.",
      invalidCredentials: "Invalid credentials",
      loginError: "An error occurred during login",
    };
    return messages[key] ?? key;
  },
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

describe("LoginPage", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockImplementation(() => null);
    // jsdom's window.location isn't a writable stub by default (assigning
    // .href throws "Not implemented: navigation"), so replace it with a
    // plain object for the duration of each test to observe the assignment
    // the same way a real browser would perform it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).location;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).location = { href: "" };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).location = originalLocation;
  });

  it("should render the login form", () => {
    render(<LoginPage />);

    expect(screen.getByText("Sign in to your account")).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("should fail to sign in with no email address", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const passwordInput = screen.getByTestId("password");
    const signInButton = screen.getByRole("button", { name: /sign in/i });

    await user.type(passwordInput, "password123");
    await user.click(signInButton);

    // HTML5 validation prevents form submission when required email is empty
    expect(signIn).not.toHaveBeenCalled();
  });

  it("should fail to sign in with no password", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const emailInput = screen.getByRole('textbox', { name: /email/i });
    const signInButton = screen.getByRole("button", { name: /sign in/i });

    await user.type(emailInput, "john@example.com");
    await user.click(signInButton);

    // HTML5 validation prevents form submission when required password is empty
    expect(signIn).not.toHaveBeenCalled();
  });

  it("should succeed to sign in with valid credentials", async () => {
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signIn as any).mockResolvedValueOnce({ error: null });

    render(<LoginPage />);

    const emailInput = screen.getByRole('textbox', { name: /email/i });
    const passwordInput = screen.getByTestId("password");
    const signInButton = screen.getByRole("button", { name: /sign in/i });

    await user.type(emailInput, "john@example.com");
    await user.type(passwordInput, "password123");
    await user.click(signInButton);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("credentials", {
        email: "john@example.com",
        password: "password123",
        redirect: false,
      });
    });

    await waitFor(() => {
      expect(window.location.href).toBe("/");
    });
  });

  it("should redirect back to the original destination after sign-in when ?redirect= is a safe same-site path", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "redirect" ? "/en/dashboard" : null
    );
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signIn as any).mockResolvedValueOnce({ error: null });

    render(<LoginPage />);

    await user.type(screen.getByRole("textbox", { name: /email/i }), "john@example.com");
    await user.type(screen.getByTestId("password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(window.location.href).toBe("/en/dashboard");
    });
  });

  it("falls back to '/' when ?redirect= is an open-redirect attempt (off-site URL)", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "redirect" ? "https://evil.com" : null
    );
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signIn as any).mockResolvedValueOnce({ error: null });

    render(<LoginPage />);

    await user.type(screen.getByRole("textbox", { name: /email/i }), "john@example.com");
    await user.type(screen.getByTestId("password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(window.location.href).toBe("/");
    });
  });

  it("should fail to sign in with invalid credentials", async () => {
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signIn as any).mockResolvedValueOnce({ error: "CredentialsSignin" });

    render(<LoginPage />);

    const emailInput = screen.getByRole('textbox', { name: /email/i });
    const passwordInput = screen.getByTestId("password");
    const signInButton = screen.getByRole("button", { name: /sign in/i });

    await user.type(emailInput, "existing@example.com");
    await user.type(passwordInput, "wrongpassword");
    await user.click(signInButton);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("credentials", {
        email: "existing@example.com",
        password: "wrongpassword",
        redirect: false,
      });
    });

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });

    // Should not navigate
    expect(window.location.href).toBe("");
  });
});
