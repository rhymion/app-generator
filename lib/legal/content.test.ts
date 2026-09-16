import { describe, it, expect } from "vitest";
import { getAvailableLegalLocales, readLegalDocument, LEGAL_DOCS, isLegalDocId } from "./content";

describe("legal content", () => {
  it("lists en and ja as available locales for both documents", () => {
    for (const doc of LEGAL_DOCS) {
      expect(getAvailableLegalLocales(doc)).toEqual(expect.arrayContaining(["en", "ja"]));
    }
  });

  it("reads the requested locale when it exists", () => {
    const result = readLegalDocument("terms", "ja", "en");
    expect(result?.locale).toBe("ja");
    expect(result?.content).toContain("利用規約");
  });

  it("falls back to the fallback locale when the requested one is missing", () => {
    const result = readLegalDocument("terms", "fr", "en");
    expect(result?.locale).toBe("en");
    expect(result?.content).toContain("Terms of Service");
  });

  it("recognizes valid legal doc ids", () => {
    expect(isLegalDocId("terms")).toBe(true);
    expect(isLegalDocId("privacy")).toBe(true);
    expect(isLegalDocId("bogus")).toBe(false);
  });
});
