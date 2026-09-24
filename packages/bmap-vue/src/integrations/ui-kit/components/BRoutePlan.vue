<script setup lang="ts">
/**
 * BRoutePlan —— 官方 UI Kit `RoutePlan` 的 Vue 薄封装（UIKIT-02 / issue #75）
 *
 * 路线面板（表单、类型标签、方案卡、开始导航按钮）全部由 `@baidumap/jsapi-ui-kit` 渲染；
 * 本组件只做 host 容器、构造前提（Map ready）、props → 构造选项、事件 DTO 与公开动作。
 *
 * 只开放驾车（ADR 2026-09-13 Official-first 决策 8）：锁定版本 `1.1.2` 的 `enabledTypes`
 * 硬编码为 `["driving"]`、`showTabs: false`，`switchType("walking" | "riding" | "transit")`
 * 是 **no-op + `console.warn`**。因此：
 * - **不暴露 `switchType()`** —— 它的每一种调用要么 no-op（`driving`）要么只 warn（其余），
 *   暴露出来等于给调用方一个做不到的承诺。上游将来真开放更多模式时，本库再补；
 * - `typechange` 事件照常绑定与转发（不丢上游事件），但它在锁定版本下**不可达**；
 * - 四类路线的 headless 能力不受此限制（issue #39 的另一条通道）。
 *
 * 刻意不做：
 * - **不接 headless 路线服务**：一次交互只走 UI Kit 一条请求通道；
 * - **不 querySelector 上游内部 DOM**，也不为路线面板自研绘制算法；
 * - **不做视野联动**：`options.map` 只在构造期被校验，构造之后上游不读它。
 *
 * props 都是**构造期选项**（上游没有对应 setter）：变更即重建 widget，不静默保留旧值。
 */
import { ref } from "vue";
import { BMapError } from "../../../core/errors/BMapError";
import { useUiKitWidget } from "../useUiKitWidget";
import {
  createRoutePlanErrorMapper,
  routePlanUnrecognized,
  toRoutePlanNavClickDTO,
  toRoutePlanPlanSelectDTO,
  toRoutePlanResultDTO,
  toRoutePlanTypeChangeDTO,
  toUpstreamRouteSearchOptions,
} from "../routePlan";
import type {
  RoutePlanDrivingOptionsDTO,
  RoutePlanMode,
  RoutePlanNavClickDTO,
  RoutePlanPlanSelectDTO,
  RoutePlanResultDTO,
  RoutePlanSearchOptionsDTO,
  RoutePlanTypeChangeDTO,
  UiKitRoutePlanWidget,
} from "../types";

export interface BRoutePlanProps {
  /** 驾车配置（策略 / 备选方案数）。构造期选项，变更会重建 widget。 */
  drivingOptions?: RoutePlanDrivingOptionsDTO;
}

const props = withDefaults(defineProps<BRoutePlanProps>(), {});

const emit = defineEmits<{
  /** 搜索成功：与 `search()` 的 Promise 结果是同一形状 */
  result: [result: RoutePlanResultDTO];
  /** 搜索失败：与 `search()` 的失败是**同一条** BMapError（`code` 为 `BMAP_SERVICE_FAILED`） */
  error: [error: BMapError];
  /** 规划类型切换（锁定版本下不可达，见文件头） */
  typechange: [change: RoutePlanTypeChangeDTO];
  /** 某条方案被选中（展开） */
  planselect: [selected: RoutePlanPlanSelectDTO];
  /** 结果被清空。上游只在 `clear()` 被调用时发这个事件（面板自身没有清空入口，实测） */
  clear: [];
  /** 点击「开始导航」 */
  navclick: [click: RoutePlanNavClickDTO];
}>();

/** 构造期选项的键名表（单一来源：`buildOptions()` 由它取值，桥按同一份内容判断是否重建）。 */
const CONSTRUCTOR_OPTION_KEYS = [
  "drivingOptions",
] as const satisfies readonly (keyof BRoutePlanProps)[];

/** 构造期选项：只透传「显式给过」的；重建判断由桥按内容做（内联字面量不会引发重建）。 */
function buildOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of CONSTRUCTOR_OPTION_KEYS) {
    const value = props[key];
    if (value !== undefined) options[key] = value;
  }
  return options;
}

/** 本组件的名字同时用于 `resource:error` 上下文与错误包装。 */
const COMPONENT = "BRoutePlan";

/** 上游错误 → 对外的 `BMapError`（映射逻辑见 `routePlan.ts`：同一个上游错误永远同一条）。 */
const toRoutePlanError = createRoutePlanErrorMapper(COMPONENT);

const hostRef = ref<HTMLElement | null>(null);

const { status, withWidget, toRawPoint } = useUiKitWidget<UiKitRoutePlanWidget>({
  component: COMPONENT,
  host: hostRef,
  buildOptions,
  // 构造期选项（上游没有 setter）：内容变化由桥重建 widget。
  constructorOptions: buildOptions,
  create: (module, host, options) => new module.RoutePlan(host, options),
  bind: () => [
    {
      event: "result",
      handler: (...args: unknown[]) => {
        const result = toRoutePlanResultDTO(args[0]);
        // 形状不认识就不发：不制造「看起来搜到路线了」的假信号。
        if (result) emit("result", result);
      },
    },
    {
      event: "error",
      handler: (...args: unknown[]) => emit("error", toRoutePlanError(args[0])),
    },
    {
      event: "typechange",
      handler: (...args: unknown[]) => {
        const change = toRoutePlanTypeChangeDTO(args[0]);
        if (change) emit("typechange", change);
      },
    },
    {
      event: "planselect",
      handler: (...args: unknown[]) => {
        const selected = toRoutePlanPlanSelectDTO(args[0]);
        if (selected) emit("planselect", selected);
      },
    },
    // 上游 `clear` 事件没有载荷。
    { event: "clear", handler: () => emit("clear") },
    {
      event: "navclick",
      handler: (...args: unknown[]) => {
        const click = toRoutePlanNavClickDTO(args[0]);
        if (click) emit("navclick", click);
      },
    },
  ],
});

// 构造期输入变化 → 重建由桥负责（`constructorOptions`）。


/**
 * 搜索路线。
 *
 * 语义区分（issue 实施步骤 4）：
 * - **Promise**：本次搜索的结算（成功给结果、失败给错误）；
 * - **事件**：`result` / `error` 是同一件事的推送面，供「不在调用点等待」的场景使用。
 *
 * 起点 / 终点支持纯数据坐标（经 Driver 转成引擎原生点）或地点名 / uid 字符串。
 */
async function search(options: RoutePlanSearchOptionsDTO): Promise<RoutePlanResultDTO> {
  const upstreamOptions = await toUpstreamRouteSearchOptions(options, (point) => toRawPoint(point));
  try {
    const raw = await withWidget((instance) => instance.search(upstreamOptions));
    const result = toRoutePlanResultDTO(raw);
    if (!result) throw routePlanUnrecognized(COMPONENT, "上游回包形状无法识别（实现可能已变更）。");
    return result;
  } catch (error) {
    // 上游是先 emit("error") 再抛，因此这里通常命中缓存，拿到的就是事件里的同一条。
    throw toRoutePlanError(error);
  }
}

/** 清空结果（同时触发上游的 `clear` 事件）。 */
function clear(): Promise<void> {
  return withWidget((instance) => instance.clear());
}

/** 当前规划类型（锁定版本恒为 `driving`）。 */
function getCurrentType(): Promise<RoutePlanMode> {
  return withWidget((instance) => instance.getCurrentType());
}

/** 上次搜索结果；没有搜索过（或被清空）时为 `null`。 */
async function getLastResult(): Promise<RoutePlanResultDTO | null> {
  const raw = await withWidget((instance) => instance.getLastResult());
  if (raw === null || raw === undefined) return null;
  const result = toRoutePlanResultDTO(raw);
  if (!result) throw routePlanUnrecognized(COMPONENT, "上游缓存的路线结果形状无法识别（实现可能已变更）。");
  return result;
}

defineExpose({
  /**
   * 桥的状态：`idle` / `loading` / `ready` / `error` / `disposed`。
   *
   * 用取值 getter 而不是直接 expose 这个 ref：`defineExpose` 会被 Vue 的 `proxyRefs` 解包，
   * runtime 读到的本来就是取值；写成 ref 会让声明与 runtime 不一致（评审 #73 第 2 项）。
   */
  get status() {
    return status.value;
  },
  search,
  clear,
  getCurrentType,
  getLastResult,
});

defineOptions({ name: "BRoutePlan" });
</script>

<template>
  <!-- host 只提供挂载点：路线面板的 DOM 全部由官方 UI Kit 渲染。 -->
  <div ref="hostRef" class="b-route-plan"></div>
</template>
