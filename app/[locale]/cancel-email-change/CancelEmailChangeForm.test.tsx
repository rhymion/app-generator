import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import CancelEmailChangeForm from "./CancelEmailChangeForm";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const search = { value: "token=abc123" };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

vi.mock("next-intl", () => {
  const messages: Record<string, string> = {
    cancelEmailChangeTitle: "Cancel the email address change",
    cancelEmailChangeHelper: "Cancel it if you did not ask for it.",
    cancelEmailChangeButton: "Cancel the change",
    cancelEmailChangeDone: "The change was cancelled.",
    cancelEmailChangeLinkInvalid: "This link is invalid or has expired.",
    cancelEmailChangeFailed: "The change could not be cancelled.",
    backToSignIn: "Back to sign in",
  };
  return { useTranslations: () => (key: string) => messages[key] ?? key, useLocale: () => "ja" };
});

function respond(status: number, body: object) {
  return vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body });
}

async function press() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /cancel the change/i }));
}

describe("CancelEmailChangeForm", () => {
  beforeEach(() => {
    search.value = "token=abc123";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels nothing until the button is pressed", () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<CancelEmailChangeForm />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Cancel it if you did not ask for it.")).toBeInTheDocument();
  });

  it("sends the token, then confirms the cancellation", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<CancelEmailChangeForm />);
    await press();
    await waitFor(() => expect(screen.getByText("The change was cancelled.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/email-change/cancel", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "abc123" });
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  it("says the link cannot be used when the server refuses the token", async () => {
    vi.stubGlobal("fetch", respond(400, { code: "INVALID_TOKEN" }));
    render(<CancelEmailChangeForm />);
    await press();
    await waitFor(() => expect(screen.getByText("This link is invalid or has expired.")).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an error and keeps the button on another failure", async () => {
    vi.stubGlobal("fetch", respond(500, { code: "EMAIL_CHANGE_CANCEL_FAILED" }));
    render(<CancelEmailChangeForm />);
    await press();
    await waitFor(() => expect(screen.getByText("The change could not be cancelled.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /cancel the change/i })).toBeEnabled();
  });

  it("shows the link as invalid without a token and never calls the server", () => {
    search.value = "";
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<CancelEmailChangeForm />);
    expect(screen.getByText("This link is invalid or has expired.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops the token from the address bar", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    vi.stubGlobal("fetch", respond(200, { ok: true }));
    render(<CancelEmailChangeForm />);
    expect(replace).toHaveBeenCalledWith(null, "", window.location.pathname);
    replace.mockRestore();
  });
});
