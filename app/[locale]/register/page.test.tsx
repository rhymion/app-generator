import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "next-auth/react";
import RegisterPage from "./page";
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
      registerTitle: "Create your account",
      namePlaceholder: "Full name",
      emailPlaceholder: "Email address",
      passwordPlaceholder: "Password",
      confirmPasswordPlaceholder: "Confirm password",
      passwordMismatch: "Passwords do not match",
      registerButton: "Register",
      haveAccount: "Already have an account? Sign in",
      emailInUse: "Email address is already in use",
      registrationFailed: "Registration failed",
    };
    return messages[key] ?? key;
  },
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}));

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should render the registration form", () => {
    render(<RegisterPage />);

    expect(screen.getByText("Create your account")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Full name")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Email address")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Confirm password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register/i })).toBeInTheDocument();
  });

  it("should fail to register with no email address", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    const nameInput = screen.getByPlaceholderText("Full name");
    const passwordInput = screen.getByPlaceholderText("Password");
    const confirmPasswordInput = screen.getByPlaceholderText("Confirm password");
    const registerButton = screen.getByRole("button", { name: /register/i });

    await user.type(nameInput, "John Doe");
    await user.type(passwordInput, "password123");
    await user.type(confirmPasswordInput, "password123");

    // The email field is required in HTML, so try to submit
    // HTML5 validation should prevent submission
    await user.click(registerButton);

    // Browser validation prevents form submission with required fields empty
    // The form should not have called signIn
    expect(signIn).not.toHaveBeenCalled();
  });

  it("should fail to register with no password", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    const nameInput = screen.getByPlaceholderText("Full name");
    const emailInput = screen.getByPlaceholderText("Email address");
    const registerButton = screen.getByRole("button", { name: /register/i });

    await user.type(nameInput, "John Doe");
    await user.type(emailInput, "john@example.com");

    // The password field is required in HTML, so try to submit
    await user.click(registerButton);

    // HTML5 validation should prevent submission
    expect(signIn).not.toHaveBeenCalled();
  });

  it("should succeed to register with user name, email address and password", async () => {
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signIn as any).mockResolvedValueOnce({ error: null });

    render(<RegisterPage />);

    const nameInput = screen.getByPlaceholderText("Full name");
    const emailInput = screen.getByPlaceholderText("Email address");
    const passwordInput = screen.getByPlaceholderText("Password");
    const confirmPasswordInput = screen.getByPlaceholderText("Confirm password");
    const registerButton = screen.getByRole("button", { name: /register/i });

    await user.type(nameInput, "John Doe");
    await user.type(emailInput, "john@example.com");
    await user.type(passwordInput, "password123");
    await user.type(confirmPasswordInput, "password123");
    await user.click(registerButton);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("credentials", {
        name: "John Doe",
        email: "john@example.com",
        password: "password123",
        confirm_password: "password123",
        redirect: false,
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("should fail to register with email address same as existing account", async () => {
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signIn as any).mockResolvedValueOnce({
      error: "Failed to sign in after registration",
    });

    render(<RegisterPage />);

    const nameInput = screen.getByPlaceholderText("Full name");
    const emailInput = screen.getByPlaceholderText("Email address");
    const passwordInput = screen.getByPlaceholderText("Password");
    const confirmPasswordInput = screen.getByPlaceholderText("Confirm password");
    const registerButton = screen.getByRole("button", { name: /register/i });

    await user.type(nameInput, "Jane Doe");
    await user.type(emailInput, "existing@example.com");
    await user.type(passwordInput, "password456");
    await user.type(confirmPasswordInput, "password456");
    await user.click(registerButton);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith("credentials", {
        name: "Jane Doe",
        email: "existing@example.com",
        password: "password456",
        confirm_password: "password456",
        redirect: false,
      });
    });

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText("Email address is already in use")).toBeInTheDocument();
    });

    // Should not navigate
    expect(mockPush).not.toHaveBeenCalled();
  });
});
