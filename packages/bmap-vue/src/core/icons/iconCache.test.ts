import { describe, it, expect } from "vitest";
import { normalizeIconDescriptor, iconCacheKey, createLruIconCache } from "./iconCache";

describe("normalizeIconDescriptor", () => {
  it("normalizes shape-like icon config to flat descriptor", () => {
    const d = normalizeIconDescriptor({
      imageUrl: "a.png",
      size: { width: 42, height: 42 },
      anchor: { x: 21, y: 21 },
    });
    expect(d.width).toBe(42);
    expect(d.anchorX).toBe(21);
  });
});

describe("iconCacheKey", () => {
  it("produces stable key for same descriptor", () => {
    const d1 = normalizeIconDescriptor({ imageUrl: "a.png", size: { width: 42, height: 42 } });
    const d2 = normalizeIconDescriptor({ imageUrl: "a.png", size: { width: 42, height: 42 } });
    expect(iconCacheKey(d1)).toBe(iconCacheKey(d2));
  });
  it("differs for different descriptor", () => {
    const d1 = normalizeIconDescriptor({ imageUrl: "a.png", size: { width: 42, height: 42 } });
    const d2 = normalizeIconDescriptor({ imageUrl: "b.png", size: { width: 42, height: 42 } });
    expect(iconCacheKey(d1)).not.toBe(iconCacheKey(d2));
  });
});

describe("createLruIconCache", () => {
  it("shares icons for same descriptor", () => {
    const cache = createLruIconCache<{ url: string }>();
    const d = normalizeIconDescriptor({ imageUrl: "a.png", size: { width: 42, height: 42 } });
    const first = cache.get(d, () => ({ url: "a.png" }));
    const second = cache.get(d, () => ({ url: "a.png" }));
    expect(first).toBe(second);
    expect(cache.size).toBe(1);
  });

  it("evicts oldest beyond maxSize (LRU)", () => {
    const cache = createLruIconCache<{ id: string }>(2);
    const a = normalizeIconDescriptor({ imageUrl: "a.png", size: { width: 1, height: 1 } });
    const b = normalizeIconDescriptor({ imageUrl: "b.png", size: { width: 1, height: 1 } });
    const c = normalizeIconDescriptor({ imageUrl: "c.png", size: { width: 1, height: 1 } });
    cache.get(a, () => ({ id: "a" }));
    cache.get(b, () => ({ id: "b" }));
    cache.get(c, () => ({ id: "c" }));
    expect(cache.size).toBe(2);
  });
});
