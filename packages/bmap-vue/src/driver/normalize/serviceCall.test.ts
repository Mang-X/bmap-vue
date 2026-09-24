/**
 * 服务调用适配器（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 这一层把 SDK 的 callback 风格收敛成「恒 resolve 的 ServiceResult」，
 * 覆盖 issue「测试要求」的第一条：成功、失败、空结果、取消与迟到回调。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createServiceCall } from "./serviceCall";
import type { ServiceCallSettle } from "../types/services";

afterEach(() => {
  vi.useRealTimers();
});

describe("createServiceCall", () => {
  it("success：回调成功时给出 data 与 SDK 状态码", async () => {
    let settle!: ServiceCallSettle<string>;
    const call = createServiceCall<string>((s) => (settle = s), { label: "geocoder.getPoint" });

    settle.success("ok", 0);
    const result = await call.result;

    expect(result).toEqual({
      status: "success",
      data: "ok",
      error: null,
      sdkStatus: 0,
    });
  });

  it("empty：回调到了但没有结果，与 failed 区分开", async () => {
    let settle!: ServiceCallSettle<string>;
    const call = createServiceCall<string>((s) => (settle = s), { label: "geocoder.getPoint" });

    settle.empty(2);
    const result = await call.result;

    expect(result.status).toBe("empty");
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(result.sdkStatus).toBe(2);
  });

  it("failed：SDK 报错时带回状态码与消息", async () => {
    let settle!: ServiceCallSettle<string>;
    const call = createServiceCall<string>((s) => (settle = s), { label: "convertor.translate" });

    settle.failed({ code: 302, message: "当天配额已用完" }, 7);
    const result = await call.result;

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: 302, message: "当天配额已用完" });
    expect(result.sdkStatus).toBe(7);
  });

  it("start 抛错时归一为 failed，而不是让 Promise reject", async () => {
    const call = createServiceCall<string>(() => {
      throw new TypeError("raw is not a function");
    }, { label: "geocoder.getPoint" });

    const result = await call.result;
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("raw is not a function");
  });

  it("迟到回调被忽略：先超时后回包不会覆盖已结算结果", async () => {
    vi.useFakeTimers();
    let settle!: ServiceCallSettle<string>;
    const call = createServiceCall<string>((s) => (settle = s), {
      label: "geocoder.getPoint",
      timeoutMs: 100,
    });

    vi.advanceTimersByTime(100);
    const result = await call.result;
    expect(result.status).toBe("timeout");
    expect(result.error?.code).toBe("BMAP_SERVICE_FAILED");

    // 真实服务在超时之后仍会回包
    settle.success("late", 0);
    await expect(call.result).resolves.toEqual(result);
  });

  it("迟到回调被忽略：取消之后到达的回调不再改结果", async () => {
    let settle!: ServiceCallSettle<string>;
    const onCancel = vi.fn();
    const call = createServiceCall<string>((s) => (settle = s), {
      label: "geocoder.getPoint",
      onCancel,
    });

    call.cancel();
    const result = await call.result;
    expect(result.status).toBe("canceled");
    expect(result.error).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);

    settle.success("late", 0);
    settle.failed({ code: 1, message: "late failure" }, 1);
    await expect(call.result).resolves.toEqual(result);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("先到者胜：重复结算只生效第一次", async () => {
    let settle!: ServiceCallSettle<string>;
    const call = createServiceCall<string>((s) => (settle = s), { label: "boundary.get" });

    settle.empty();
    settle.success("second");
    const result = await call.result;

    expect(result.status).toBe("empty");
  });

  it("结算之后 cancel 是 no-op（不会把结果改成 canceled，也不触发 onCancel）", async () => {
    let settle!: ServiceCallSettle<string>;
    const onCancel = vi.fn();
    const call = createServiceCall<string>((s) => (settle = s), { label: "boundary.get", onCancel });

    settle.success("ok", 0);
    await call.result;
    call.cancel();

    await expect(call.result).resolves.toMatchObject({ status: "success", data: "ok" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("超时后清理 timer，不留悬挂的 setTimeout", async () => {
    vi.useFakeTimers();
    let settle!: ServiceCallSettle<string>;
    const call = createServiceCall<string>((s) => (settle = s), {
      label: "geocoder.getPoint",
      timeoutMs: 50,
    });

    settle.empty();
    await call.result;
    // 已结算后即使越过超时点，也不应产生第二次结算
    vi.advanceTimersByTime(1000);
    await expect(call.result).resolves.toMatchObject({ status: "empty" });
  });
});
