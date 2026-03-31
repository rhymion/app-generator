import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "next-auth/react";
import LoginPage from "./page";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock @/i18n/navigation (replaces next/navigation in this component)
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, refresh: mockRefresh })),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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
      expect(mockPush).toHaveBeenCalledWith("/");
      expect(mockRefresh).toHaveBeenCalled();
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
    expect(mockPush).not.toHaveBeenCalled();
  });
});
