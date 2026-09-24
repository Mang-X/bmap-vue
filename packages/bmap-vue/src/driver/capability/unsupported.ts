/**
 * Unsupported 策略与错误
 *
 * 区分：
 * - 能力不存在 -> UnsupportedCapabilityError (BMAP_CAPABILITY_UNSUPPORTED)
 * - 能力存在但调用失败 -> BMAP_SDK_CALL_FAILED
 * - 参数非法 -> BMAP_INVALID_ARGUMENT
 * - 资源已销毁 -> BMAP_RESOURCE_DISPOSED
 *
 * 不能把所有 TypeError 都归类为版本不支持。
 */
import { BMapError } from "../../core/errors/BMapError";
import type { BMapEngine } from "../types/bmap";
import type { Capability } from "./catalog";

export type UnsupportedBehavior = "throw" | "warn" | "silent";

export class UnsupportedCapabilityError extends BMapError {
  readonly capability: Capability;
  readonly engine: BMapEngine;
  readonly version: string;

  constructor(capability: Capability, engine: BMapEngine, version: string) {
    super(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `${capability} is not supported by ${engine} ${version}`,
      { capability, engine, version },
    );
    this.capability = capability;
    this.engine = engine;
    this.version = version;
  }
}
