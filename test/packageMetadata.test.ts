import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// npmjs.com and npm search show package.json "description" first, and the
// README, CHANGELOG and error messages are in English. Keep the metadata
// English too (no Finnish letters).
const PKG = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(PKG, "utf8")) as {
  description: string;
  keywords: string[];
};
const FINNISH_LETTERS = /[äöåÄÖÅ]/;

describe("package.json metadata", () => {
  it("description has no Finnish letters and is a reasonable length", () => {
    expect(pkg.description).not.toMatch(FINNISH_LETTERS);
    expect(pkg.description.length).toBeGreaterThan(20);
    expect(pkg.description.length).toBeLessThanOrEqual(220);
  });

  it("keywords have no Finnish letters", () => {
    for (const keyword of pkg.keywords) {
      expect(keyword).not.toMatch(FINNISH_LETTERS);
    }
  });
});
