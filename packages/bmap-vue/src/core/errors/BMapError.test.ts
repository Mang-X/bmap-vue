import { describe, it, expect } from "vitest";
import { BMapError } from "./BMapError";

describe("BMapError", () => {
  it("constructs with code, message and cause", () => {
    const err = new BMapError("BMAP_SDK_LOAD_FAILED", "load failed", {
      cause: new Error("network"),
      mapId: Symbol("m1"),
      component: "BMap",
    });
    expect(err.name).toBe("BMapError");
    expect(err.code).toBe("BMAP_SDK_LOAD_FAILED");
    expect(err.retryable).toBe(true);
    expect(err.component).toBe("BMap");
    expect(err.toJSON().mapId).toBeDefined();
  });

  it("marks non-retryable errors correctly", () => {
    const err = new BMapError("BMAP_RUNTIME_DISPOSED", "disposed");
    expect(err.retryable).toBe(false);
  });

  it("exposes static code constants", () => {
    expect(BMapError.codes.SDK_CONFIG_CONFLICT).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect(BMapError.codes.RUNTIME_DISPOSED).toBe("BMAP_RUNTIME_DISPOSED");
  });
});
