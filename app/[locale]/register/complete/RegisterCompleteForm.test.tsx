import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "next-auth/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import RegisterCompleteForm from "./RegisterCompleteForm";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, refresh: mockRefresh })),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const search = { value: "token=abc123" };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

vi.mock("next-intl", () => {
  const messages: Record<string, string> = {
    registerCompleteTitle: "Finish signing up",
    namePlaceholder: "Full name",
    passwordPlaceholder: "Password",
    confirmPasswordPlaceholder: "Confirm password",
    passwordMismatch: "Passwords do not match",
    registerCompleteButton: "Create account",
    registerLinkInvalid: "This sign-up link cannot be used.",
    registerStartAgain: "Sign up again",
    registrationFailed: "Registration failed",
    legalAgreementNotice: "By creating an account, you agree to our <terms>Terms of Service</terms> and <privacy>Privacy Policy</privacy>.",
  };
  const t = (key: string) => messages[key] ?? key;
  t.rich = (key: string, tags: Record<string, (chunks: React.ReactNode) => React.ReactNode>) => {
    const raw = messages[key] ?? key;
    return raw.split(/(<\w+>.*?<\/\w+>)/g).map((part, i) => {
      const match = /^<(\w+)>(.*)<\/\w+>$/.exec(part);
      return match && tags[match[1]] ? <span key={i}>{tags[match[1]](match[2])}</span> : part;
    });
  };
  return { useTranslations: () => t };
});

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

async function fillAndSubmit(password = "correct horse battery", confirm = password) {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: /full name/i }), "New Person");
  await user.type(screen.getByTestId("password"), password);
  await user.type(screen.getByTestId("confirm-password"), confirm);
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

describe("RegisterCompleteForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    search.value = "token=abc123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the token, name and password, then signs the new user in", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ok: true, email: "new@example.com" }) });
    vi.stubGlobal("fetch", fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (signIn as any).mockResolvedValueOnce({ error: null });
    render(<RegisterCompleteForm />);

    await fillAndSubmit();

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/register/complete");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "abc123", name: "New Person", password: "correct horse battery" });
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "new@example.com", password: "correct horse battery", redirect: false });
  });

  it("removes the token from the address bar once read", () => {
    window.history.replaceState(null, "", "/en/register/complete?token=abc123");
    render(<RegisterCompleteForm />);
    expect(window.location.search).toBe("");
  });

  it("does not post when the passwords differ", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<RegisterCompleteForm />);

    await fillAndSubmit("correct horse battery", "correct horse battern");

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the invalid-link message and a way to start again on INVALID_TOKEN", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ code: "INVALID_TOKEN" }) }));
    render(<RegisterCompleteForm />);

    await fillAndSubmit();

    expect(await screen.findByText("This sign-up link cannot be used.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign up again/i })).toHaveAttribute("href", "/register");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows the password-policy message for a weak password and keeps the form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ code: "WEAK_PASSWORD", error: "Password must be at least 8 characters." }),
    }));
    render(<RegisterCompleteForm />);

    await fillAndSubmit("short", "short");

    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("shows the invalid-link message straight away when the link has no token", () => {
    search.value = "";
    render(<RegisterCompleteForm />);
    expect(screen.getByText("This sign-up link cannot be used.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create account/i })).not.toBeInTheDocument();
  });
});
