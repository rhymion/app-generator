import { describe, expect, it } from "vitest";
import { isDomainAllowed } from "./domain-allow-list";

describe("isDomainAllowed", () => {
  it("allows everyone when the list is empty", () => {
    expect(isDomainAllowed("google", "a@gmail.com", undefined, [])).toBe(true);
  });

  it("matches the Google hd claim case-insensitively", () => {
    expect(isDomainAllowed("google", "a@corp.example", { hd: "Corp.Example" }, ["corp.example"])).toBe(true);
  });

  it("rejects a Google sign-in without hd even when the email domain is listed", () => {
    expect(isDomainAllowed("google", "a@corp.example", {}, ["corp.example"])).toBe(false);
    expect(isDomainAllowed("google", "a@corp.example", undefined, ["corp.example"])).toBe(false);
  });

  it("rejects a Google sign-in whose hd differs from the email domain", () => {
    expect(isDomainAllowed("google", "a@corp.example", { hd: "other.example" }, ["corp.example"])).toBe(false);
  });

  it("falls back to the email domain for other providers", () => {
    expect(isDomainAllowed("github", "a@Corp.Example", undefined, ["corp.example"])).toBe(true);
    expect(isDomainAllowed("github", "a@other.example", undefined, ["corp.example"])).toBe(false);
  });
});
