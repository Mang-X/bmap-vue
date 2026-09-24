/**
 * CapabilityRegistry
 *
 * 运行时能力探测：显式 override → 声明状态 → engine 白名单 → raw member 存在性。
 * require() 按 unsupported 策略 throw/warn/silent。
 *
 * ## 「成员存在性」有三个来源（#29 评审 P1）
 *
 * `rawMembers` 的判定顺序是：**命名空间顶层** → **`Map.prototype`** → **运行时观察到的实例成员**
 * （`observeInstanceMembers()`）。
 *
 * 第三条是必须的，不是补充：真实 JSAPI 4.0 有一部分 Map 方法挂在**实例**上而不是原型上
 * （实测 `rawMap.setZoom` 是函数、`Map.prototype.setZoom` 是 `undefined`，而同组的 `getZoom`
 * 在原型上）。只查前两个来源会让 `supports("map.zoom")` 在真实引擎上**假阴性** —— 而
 * `supports()` 是 `<BMap ref>` 公开命令面的一部分，于是业务最自然的
 * `if (map.supports("map.zoom")) map.setZoom(16)` 会在**真的支持** zoom 的引擎上被跳过。
 *
 * 实例成员只能在**对象建出来之后**才观察得到，因此由对应的 Facet 在创建成功后登记
 * （`driver/jsapi-v4/map.ts` 的 `create()` 调 `observeInstanceMembers(raw)`）。在还没有实例
 * 的那段时间里 `supports("map.zoom")` 仍可能是 `false` —— 而那时也**确实没有可操作的对象**，
 * 这条时序写进了 `BMapExpose.supports()` 的文档。
 */
import { logger } from "../../core/logger";
import type { BMapEngine } from "../types/bmap";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_IDS,
  type Capability,
  type CapabilityDescriptor,
  type CapabilityFamily,
  type CapabilityStatus,
} from "./catalog";
import { UnsupportedCapabilityError, type UnsupportedBehavior } from "./unsupported";

export type CapabilityReason =
  | "supported"
  | "engine-unsupported"
  | "raw-member-missing"
  | "status-unsupported"
  | "overridden";

export interface CapabilityExplanation {
  id: Capability;
  supported: boolean;
  reason: CapabilityReason;
  engine: BMapEngine;
  version: string;
  /**
   * 所属能力族。目录**未收录**的 id 没有 family 可报，留空而不是编一个值
   * （原先兜的是 `"runtime"`，那个 family 已随 #104 R10 删除）。
   */
  family?: CapabilityFamily;
  status: CapabilityStatus;
  runtimeOnly: boolean;
}

export interface CapabilityRegistry {
  supports(capability: Capability): boolean;
  require(capability: Capability): void;
  list(): readonly Capability[];
  explain(capability: Capability): CapabilityExplanation;
  /** 只读访问能力描述符（能力矩阵生成与诊断使用） */
  descriptor(capability: Capability): CapabilityDescriptor | undefined;
  /**
   * 登记一个**运行时实例**上实际存在的成员（只收函数），供「实例自有成员」这一类探测使用。
   *
   * 幂等且只增不减（能力探测不该因为某个实例被销毁而回退）；由 Facet 在创建对象成功后调用。
   * 见文件头的「三个来源」。传 `null` / `undefined` 是 no-op。
   */
  observeInstanceMembers(source: unknown): void;
}

export interface CreateCapabilityRegistryOptions {
  engine: BMapEngine;
  version: string;
  rawSdk: unknown;
  unsupported?: UnsupportedBehavior;
  overrides?: Partial<Record<Capability, boolean>>;
}

function hasMember(rawSdk: unknown, member: string): boolean {
  const sdk = rawSdk as Record<string, unknown> | null | undefined;
  if (!sdk) return false;
  if (typeof sdk[member] !== "undefined") return true;
  const mapProto = (sdk.Map as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  return typeof mapProto?.[member] === "function";
}

/**
 * 从一个实例（含原型链）收集**函数**成员名。
 *
 * 只收函数：`rawMembers` 的每一项都是「构造器名或方法名」（见 `catalog.ts` 的约定），
 * 而实例上的数据字段（`container` / `zoomLevel` / `hashCode` …）不该被当成能力依据。
 * 深度上限是防御性的 —— 原型链异常长时不做无界遍历。
 */
function collectFunctionMembers(source: unknown): string[] {
  const names: string[] = [];
  let current = source as object | null;
  for (let depth = 0; current && current !== Object.prototype && depth < 8; depth += 1) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (typeof (current as Record<string, unknown>)[key] === "function") names.push(key);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return names;
}

export function createCapabilityRegistry(
  options: CreateCapabilityRegistryOptions,
): CapabilityRegistry {
  const { engine, version, rawSdk, unsupported = "warn", overrides } = options;
  /** 运行时观察到的实例成员（见文件头的「三个来源」）。 */
  const observedMembers = new Set<string>();

  type BaseReason = Exclude<CapabilityReason, "overridden">;

  const evaluate = (
    capability: Capability,
  ): { supported: boolean; reason: BaseReason; descriptor: CapabilityDescriptor | undefined } => {
    const descriptor = CAPABILITY_CATALOG[capability];
    if (!descriptor) return { supported: false, reason: "engine-unsupported", descriptor };
    if (descriptor.status === "unsupported") {
      return { supported: false, reason: "status-unsupported", descriptor };
    }
    if (!descriptor.engines.includes(engine)) {
      return { supported: false, reason: "engine-unsupported", descriptor };
    }
    for (const member of descriptor.rawMembers ?? []) {
      if (!hasMember(rawSdk, member) && !observedMembers.has(member)) {
        return { supported: false, reason: "raw-member-missing", descriptor };
      }
    }
    return { supported: true, reason: "supported", descriptor };
  };

  const baseSupported = (capability: Capability): boolean => {
    const override = overrides?.[capability];
    if (typeof override === "boolean") return override;
    return evaluate(capability).supported;
  };

  const registry: CapabilityRegistry = {
    supports(capability) {
      return baseSupported(capability);
    },

    require(capability) {
      if (registry.supports(capability)) return;
      const error = new UnsupportedCapabilityError(capability, engine, version);
      if (unsupported === "throw") throw error;
      if (unsupported === "warn") logger.warn(error.message, { capability, engine, version });
    },

    list() {
      return CAPABILITY_IDS.filter((capability) => baseSupported(capability));
    },

    observeInstanceMembers(source) {
      if (!source) return;
      for (const name of collectFunctionMembers(source)) observedMembers.add(name);
    },

    explain(capability) {
      // `Capability` 是目录 id 的联合，但调用方可以带着**未收录**的 id 进来（外部字符串、
      // 或 `as Capability` 的探针），而「未收录」正是单引擎下 `engine-unsupported` 的唯一可达路径
      // （见 registry.test.ts 与 v3-capability-catalog.test.ts 的 `does.not-exist`）。
      // 所以这里按「可能没有描述符」写：`family` 留空（不编一个值——原先兜的是 `"runtime"`，
      // 那个 family 已随 #104 R10 删除，报出来就是个没人能解释的幽灵值）。
      const descriptor: CapabilityDescriptor | undefined = CAPABILITY_CATALOG[capability];
      const metadata = {
        id: capability,
        engine,
        version,
        family: descriptor?.family,
        status: descriptor?.status ?? ("unsupported" as CapabilityStatus),
        runtimeOnly: descriptor?.runtimeOnly ?? true,
      };

      const override = overrides?.[capability];
      if (typeof override === "boolean") {
        return { ...metadata, supported: override, reason: "overridden" };
      }

      const { supported, reason } = evaluate(capability);
      return { ...metadata, supported, reason };
    },

    descriptor(capability) {
      return CAPABILITY_CATALOG[capability];
    },
  };

  return registry;
}
