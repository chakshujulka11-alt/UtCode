import { describe, expect, it } from "vitest";
import { sanitizeWindowBounds, boundsOnScreen } from "../src/main/store/persistentStore";

describe("sanitizeWindowBounds", () => {
  it("keeps sane bounds", () => {
    expect(sanitizeWindowBounds({ width: 1400, height: 900, x: 100, y: 50 })).toMatchObject({ width: 1400, height: 900, x: 100, y: 50 });
  });
  it("rejects too-small or bogus bounds", () => {
    expect(sanitizeWindowBounds(null)).toBeNull();
    expect(sanitizeWindowBounds({ width: 100, height: 200 })).toBeNull();
    expect(sanitizeWindowBounds({ width: Number.NaN, height: 900 })).toBeNull();
    expect(sanitizeWindowBounds({ width: 99999, height: 900 })).toBeNull();
  });
  it("drops unusable coordinates but keeps size", () => {
    const r = sanitizeWindowBounds({ width: 1200, height: 800, x: Number.NaN, y: 30 });
    expect(r).toEqual({ width: 1200, height: 800 });
  });
});

describe("boundsOnScreen", () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  it("accepts on-screen positions", () => {
    expect(boundsOnScreen({ width: 1000, height: 700, x: 100, y: 100 }, displays)).toBe(true);
  });
  it("rejects unplugged-monitor positions", () => {
    expect(boundsOnScreen({ width: 1000, height: 700, x: 4000, y: 100 }, displays)).toBe(false);
  });
  it("always accepts when no stored position", () => {
    expect(boundsOnScreen({ width: 1000, height: 700 }, displays)).toBe(true);
  });
});
