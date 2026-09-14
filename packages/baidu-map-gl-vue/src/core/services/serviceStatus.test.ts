/**
 * 服务状态口径（M7-SERVICE-CORE / issue #38）
 *
 * 这一层是「六个 composable 共用的一份状态机口径」，所以它自己要被直接断言：
 * 一旦取值集合或 `toServiceErrorInfo` 松了，使用方拿到的状态就会自相矛盾，
 * 而那种错在 composable 层的用例里往往只表现为「某个断言偶尔不过」。
 */
import { describe, it, expect } from "vitest";
import { BMapError } from "../errors/BMapError";
import type { ServiceCallStatus } from "../../driver/types/services";
import {
  SERVICE_CALL_STATUSES,
  settledServiceResult,
  toServiceErrorInfo,
} from "./serviceStatus";

describe("core/services：服务状态口径", () => {
  it("终态集合与 Driver 的 ServiceCallStatus 完全一致（不多不少）", () => {
    expect([...SERVICE_CALL_STATUSES]).toEqual([
      "success",
      "empty",
      "failed",
      "timeout",
      "canceled",
    ]);

    // 逐个成员求条件类型再取并集，要求结果是 `never`：只有「两边的取值集合完全相等」
    // 才能通过。写成「联合整体可赋值」会在只补齐一部分时静默通过（评审抓过一次）。
    type MissingInList = Exclude<ServiceCallStatus, (typeof SERVICE_CALL_STATUSES)[number]>;
    type ExtraInList = Exclude<(typeof SERVICE_CALL_STATUSES)[number], ServiceCallStatus>;
    const noMissing: MissingInList[] = [];
    const noExtra: ExtraInList[] = [];
    const covered: never[] = [...noMissing, ...noExtra];
    expect(covered).toEqual([]);
  });

  it("toServiceErrorInfo：BMapError 保留 code，普通 Error / 非 Error 归成 null code", () => {
    expect(toServiceErrorInfo(new BMapError("BMAP_HANDLE_FOREIGN", "句柄不属于当前 Client"))).toEqual({
      code: "BMAP_HANDLE_FOREIGN",
      message: "句柄不属于当前 Client",
    });
    expect(toServiceErrorInfo(new TypeError("boom"))).toEqual({ code: null, message: "boom" });
    expect(toServiceErrorInfo("plain")).toEqual({ code: null, message: "plain" });
  });

  it("settledServiceResult：终态载荷恒冻结、data 为 null（取消/不支持时不带数据）", () => {
    const canceled = settledServiceResult<number>("canceled");
    expect(canceled).toEqual({ status: "canceled", data: null, error: null, sdkStatus: null });
    expect(Object.isFrozen(canceled)).toBe(true);
  });
});
