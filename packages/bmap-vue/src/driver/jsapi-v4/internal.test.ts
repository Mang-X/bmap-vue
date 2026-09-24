/**
 * v4 namespace 边界（M3A2-01 / issue #19）
 *
 * 驱动层只认识**结构化**的 v4 命名空间：构造器必须是函数，缺成员要给出结构化错误，
 * 而不是让 `new undefined()` 在调用点炸出难以定位的 TypeError。
 */
import { describe, it, expect } from "vitest";
import {
  JSAPI_V4_DRIVER_MEMBERS,
  assertJsapiV4Namespace,
  callOptional,
  findMissingNamespaceMembers,
  isJsapiV4Namespace,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
} from "./internal";

/** 官方 4.0 命名空间最小可用形状（每个成员都是构造器） */
function completeNamespace(): Record<string, unknown> {
  return {
    Map: class {},
    Point: class {},
    Pixel: class {},
    Size: class {},
    Bounds: class {},
    Marker: class {},
    VERSION: "4.0",
  };
}

describe("findMissingNamespaceMembers", () => {
  it("列出驱动缺失的成员（官方 namespace 的子集也要能定位缺谁）", () => {
    expect(findMissingNamespaceMembers({ Map: class {}, Point: class {} })).toEqual([
      "Pixel",
      "Size",
      "Bounds",
    ]);
  });

  it("完整 namespace 返回空数组", () => {
    expect(findMissingNamespaceMembers(completeNamespace())).toEqual([]);
  });

  it("null / 原始值视为全部缺失", () => {
    expect(findMissingNamespaceMembers(null)).toEqual([...JSAPI_V4_DRIVER_MEMBERS]);
    expect(findMissingNamespaceMembers("BMap")).toEqual([...JSAPI_V4_DRIVER_MEMBERS]);
  });

  it("成员存在但为 null 也算缺失", () => {
    expect(findMissingNamespaceMembers({ ...completeNamespace(), Size: null })).toEqual(["Size"]);
  });

  it("成员存在但不是构造器也算缺失（防止打错名字到一半的假 namespace）", () => {
    expect(findMissingNamespaceMembers({ ...completeNamespace(), Pixel: 1 })).toEqual(["Pixel"]);
  });
});

describe("isJsapiV4Namespace", () => {
  it("完整 namespace 通过", () => {
    expect(isJsapiV4Namespace(completeNamespace())).toBe(true);
  });

  it("缺成员不通过", () => {
    expect(isJsapiV4Namespace({ Map: class {} })).toBe(false);
    expect(isJsapiV4Namespace(undefined)).toBe(false);
  });

  it("callable namespace 也接受（全局对象允许被封装成函数对象）", () => {
    const callable = Object.assign(() => undefined, completeNamespace());
    expect(isJsapiV4Namespace(callable)).toBe(true);
  });
});

describe("assertJsapiV4Namespace", () => {
  it("返回命名空间本体", () => {
    const namespace = completeNamespace();
    expect(assertJsapiV4Namespace(namespace)).toBe(namespace);
  });

  it("缺成员抛结构化错误并点名缺失成员", () => {
    try {
      assertJsapiV4Namespace({ Map: class {}, Point: class {} });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toMatchObject({ code: "BMAP_SDK_CALL_FAILED" });
      expect((error as Error).message).toContain("Pixel");
    }
  });
});

describe("readNamespaceMember / namespaceCtor", () => {
  it("readNamespaceMember 对缺失成员返回 undefined", () => {
    expect(readNamespaceMember(completeNamespace(), "Point")).toBeTypeOf("function");
    expect(readNamespaceMember(completeNamespace(), "NotHere")).toBeUndefined();
  });

  it("namespaceCtor 取到构造器并在缺失时抛结构化错误", () => {
    const ctor = namespaceCtor(completeNamespace(), "Point");
    expect(typeof ctor).toBe("function");
    expect(() => namespaceCtor(completeNamespace(), "Nope")).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });
});

describe("sdkCall / callOptional", () => {
  it("sdkCall 透传返回值", () => {
    expect(sdkCall("Point", () => 42)).toBe(42);
  });

  it("sdkCall 把底层异常包装为结构化错误并保留 cause", () => {
    const cause = new Error("非法参数");
    try {
      sdkCall("Point", () => {
        throw cause;
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toMatchObject({ code: "BMAP_SDK_CALL_FAILED" });
      expect((error as { cause?: unknown }).cause).toBe(cause);
    }
  });

  it("callOptional 在方法缺失时静默返回 undefined，存在时以实例为接收者调用", () => {
    expect(callOptional({}, "nope")).toBeUndefined();
    const receiver = { value: 7, read() { return this.value; } };
    expect(callOptional(receiver, "read")).toBe(7);
  });
});
