import { describe, expect, it } from "vitest";
import { domainListFromEnv } from "./site-config";

// AUTH_ALLOWED_DOMAINS / REGISTRATION_ALLOWED_DOMAINS (docs/knowledge/authentication.md).
describe("domainListFromEnv", () => {
  it("keeps the list written in site-config when the variable is unset or blank", () => {
    expect(domainListFromEnv(undefined, ["corp.example"])).toEqual(["corp.example"]);
    expect(domainListFromEnv("", ["corp.example"])).toEqual(["corp.example"]);
    expect(domainListFromEnv("  ", [])).toEqual([]);
  });

  it("replaces the written list with a comma-separated value", () => {
    expect(domainListFromEnv("example.com,example.co.jp", ["corp.example"])).toEqual(["example.com", "example.co.jp"]);
  });

  it("trims, lower-cases, drops empty entries and duplicates", () => {
    expect(domainListFromEnv(" Example.COM , ,example.com,sub.Example.com,", [])).toEqual(["example.com", "sub.example.com"]);
  });

  it("normalises the written fallback the same way", () => {
    expect(domainListFromEnv(undefined, [" Corp.Example "])).toEqual(["corp.example"]);
  });
});
