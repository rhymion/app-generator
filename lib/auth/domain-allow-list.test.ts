import { describe, expect, it } from "vitest";
import { isDomainAllowed, isRegistrationEmailAllowed, registrationAllowedDomains } from "./domain-allow-list";

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

describe("isRegistrationEmailAllowed (Issue #1093)", () => {
  it("allows every address when the list is empty", () => {
    expect(isRegistrationEmailAllowed("a@anything.org", [])).toBe(true);
  });

  it("matches the domain exactly and case-insensitively", () => {
    expect(isRegistrationEmailAllowed("a@Example.COM", ["example.com"])).toBe(true);
    expect(isRegistrationEmailAllowed("a@sub.example.com", ["example.com"])).toBe(false);
    expect(isRegistrationEmailAllowed("a@example.com.evil.net", ["example.com"])).toBe(false);
    expect(isRegistrationEmailAllowed("a@notexample.com", ["example.com"])).toBe(false);
  });

  it("uses the part after the last @ and refuses a malformed address", () => {
    expect(isRegistrationEmailAllowed('"x@example.com"@evil.net', ["example.com"])).toBe(false);
    expect(isRegistrationEmailAllowed("no-at-sign", ["example.com"])).toBe(false);
    expect(isRegistrationEmailAllowed("@example.com", ["example.com"])).toBe(false);
  });
});

describe("registrationAllowedDomains", () => {
  it("is empty when the site config predates the setting", () => {
    expect(registrationAllowedDomains({})).toEqual([]);
  });
  it("returns the configured strings", () => {
    expect(registrationAllowedDomains({ registrationAllowedDomains: ["a.com", 3] })).toEqual(["a.com"]);
  });
});
