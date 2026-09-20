/**
 * 原生可视化图层组件的**共享装配**（M6 / issue #36）
 *
 * `BLineLayer` / `BFillLayer` / `BHeatmapLayer` / `BTrackLineLayer` 四个组件在装配上的差异只有
 * 四项，因此这里收成一处，避免四份同源实现各自漂移：
 *
 * | 差异 | 怎么表达 |
 * | --- | --- |
 * | 图层种类 | `options.kind` |
 * | 额外的构造期选项 | `options.extraCtorOptions`（如 `FillLayer` 的 `border`） |
 * | 有没有拾取面 | `options.pickEvents`（不给就不绑事件） |
 * | 组件名（诊断用） | `options.component` |
 *
 * ## 重建指纹从**构造期选项袋**派生，不再手写一份字段清单
 *
 * 「哪些 prop 变了要换实例」= 「构造期选项袋变了」——两件事本来就是同一件。手写一份字段清单时，
 * 新增一个构造期 prop 却忘了加进清单，表现是「改了没反应」而不是报错。因此这里对投影出来的选项袋
 * 做稳定指纹。代价：构造期选项里**不能**有函数（会被折叠成 `fn`）；这四个图层的构造选项全是原始值，
 * 将来若真有函数型构造选项，要显式处理（同 `forwardCallback` 的口径）。
 *
 * ## 拾取事件无条件订阅
 *
 * 四个官方事件（`click` / `dblclick` / `rightclick` / `mousemove`）在实例创建时一次性订阅，不按
 * 「父级有没有绑 handler」做条件订阅——Vue 运行时不把 emit listener 放进 `props` / `attrs`，也没有
 * 「监听器变了」的响应式信号（#28 实测），条件订阅必然漏事件。未绑定 handler 的由 `emit` 丢弃，
 * 成本是每个实例 4 个监听器。
 *
 * 本文件是 `.ts`（不是 SFC）：它是给四个 SFC 复用的**装配函数**，本身不产生组件。
 */
import { normalizeIdField } from "../../core/data/identity";
import { createDevWarnOnce } from "../../core/logger";
import { layerDataIdentity, stableLayerValue } from "../../core/layers/LayerSpec";
import { resolveFeaturePick } from "../../core/layers/nativeLayerPick";
import { projectLayerStyle } from "../../core/layers/nativeLayerStyle";
import {
  useNativeLayerResource,
  type NativeLayerResource,
  type NativeLayerUnifiedFields,
} from "../../core/composables/useNativeLayerResource";
import type { NativeLayerKind } from "../../driver/types/native-layers";
import type { BMapFeaturePick } from "../../types/components";

/** 官方四类专页图层共同派发的拾取事件（`NormalLayerEventMap` 去掉 `dataparsed`）。 */
export const NATIVE_LAYER_PICK_EVENTS = [
  "click",
  "dblclick",
  "rightclick",
  "mousemove",
] as const;

/**
 * 四个组件 props 的**并集**（各组件只声明自己 kind 支持的那部分）。
 *
 * `style` 在这里是 `object` 而不是 `Record<string, unknown>`：各组件的强类型 style 接口（如
 * `BLineLayerStyle`）**没有隐式索引签名**，收窄成 `Record` 会让它们不满足这个约束（而那正是
 * 「强类型 style」的意义）。
 */
export interface VisualLayerPropsLike extends NativeLayerUnifiedFields {
  data?: object | null;
  style?: object;
  idKey?: string;
  crs?: string;
  enablePicked?: boolean;
  pickWidth?: number;
  pickHeight?: number;
  autoSelect?: boolean;
  selectedColor?: string;
}

/** 领域事件派发器（组件把 `defineEmits` 的 emit 包一层传进来：事件名来自白名单）。 */
export type PickEmitter = (event: string, pick: BMapFeaturePick) => void;

/** 四个拾取事件的**逐名**派发器（见 `pickEmitterFor`）。 */
export interface VisualLayerEmitters {
  click(pick: BMapFeaturePick): void;
  dblclick(pick: BMapFeaturePick): void;
  rightclick(pick: BMapFeaturePick): void;
  mousemove(pick: BMapFeaturePick): void;
}

/**
 * 组装「按事件名派发」的 `PickEmitter`。
 *
 * 为什么不能直接把 Vue 的 `emit` 传进来：`defineEmits` 推导出的 `emit` 是**每个事件一个重载**的
 * 函数类型，而联合事件名（`"click" | "dblclick" | …`）不满足任何一个重载（TS2769）。逐名分派是
 * 唯一不需要 `as any` 的写法——`any` 会把「白名单与 `defineEmits` 声明漂移」这件事一起吞掉。
 */
export function pickEmitterFor(emitters: VisualLayerEmitters): PickEmitter {
  return (event, pick) => {
    switch (event) {
      case "click":
        emitters.click(pick);
        return;
      case "dblclick":
        emitters.dblclick(pick);
        return;
      case "rightclick":
        emitters.rightclick(pick);
        return;
      case "mousemove":
        emitters.mousemove(pick);
        return;
      default:
        // 白名单（`NATIVE_LAYER_PICK_EVENTS`）里的事件都有对应分支；未知事件名不派发。
        return;
    }
  };
}

export interface UseVisualLayerOptions<Props extends VisualLayerPropsLike> {
  kind: NativeLayerKind;
  component: string;
  /** 额外的构造期选项（并进选项袋，因此自动参与重建指纹）。 */
  extraCtorOptions?(props: Readonly<Props>): Record<string, unknown>;
  /** 需要转发成同名领域事件的官方拾取事件；不给 = 该 kind 没有拾取面（不绑任何事件）。 */
  pickEvents?: readonly string[];
  emitPick?: PickEmitter;
}

export interface VisualLayerRuntime {
  readonly resource: NativeLayerResource;
}

export function useVisualLayer<Props extends VisualLayerPropsLike>(
  props: Readonly<Props>,
  options: UseVisualLayerOptions<Props>,
): VisualLayerRuntime {
  const { kind, component } = options;
  const warnOnce = createDevWarnOnce();

  /** 构造期选项袋（官方构造参数里不能就地更新的那些）。 */
  const ctorOptions = (p: Readonly<Props>): Record<string, unknown> => {
    const bag: Record<string, unknown> = {};
    // 归一化只做类型归一（非字符串 → 未声明），**不**收窄取值：空字符串也是合法字段名
    const idKey = normalizeIdField(p.idKey);
    if (idKey !== undefined) bag.idKey = idKey;
    if (p.crs !== undefined) bag.crs = p.crs;
    if (p.enablePicked !== undefined) bag.enablePicked = p.enablePicked;
    if (p.pickWidth !== undefined) bag.pickWidth = p.pickWidth;
    if (p.pickHeight !== undefined) bag.pickHeight = p.pickHeight;
    if (p.autoSelect !== undefined) bag.autoSelect = p.autoSelect;
    if (p.selectedColor !== undefined) bag.selectedColor = p.selectedColor;
    return { ...bag, ...(options.extraCtorOptions?.(p) ?? {}) };
  };

  const resource = useNativeLayerResource<Props>(props, {
    component,
    kind,
    ctorOptions,
    // 指纹直接派生自选项袋：新增构造期 prop ⇒ 自动进指纹（不会出现「改了没反应」）
    rebuildKey: (p) => `${kind}|${stableLayerValue(ctorOptions(p))}`,
    style: () => projectLayerStyle(() => props.style as Record<string, unknown> | undefined),
    data: {
      // 数据按**引用**比较：整份 GeoJSON 序列化一次就是 O(n)，而这个指纹**每次 props 变化**都要算。
      // 代价与 M7 图层内核一致：原地修改同一份 data 不会被感知（Vue 的响应式约定也是换引用才更新）。
      key: () => layerDataIdentity(props.data),
      /**
       * `null` = 明确「没有数据」⇒ 换一个没有数据的实例（这批图层没有公开的清空入口）；
       * `undefined` = **不表态** ⇒ 不产生任何 SDK 调用，与 `LayerSpec` 的口径一致。
       */
      state: () => (props.data === null ? "empty" : props.data === undefined ? "absent" : "value"),
      value: () => props.data,
    },
    identity: (p) => normalizeIdField(p.idKey),
    bind: ({ handle, context, scope, isQuiescing }) => {
      const events = context.client.driver.events;
      for (const name of options.pickEvents ?? []) {
        scope.add(
          events.on(handle, name, (event) => {
            // 摘除期间（严格换实例的 quiesce 阶段）不穿透：SDK 可能在 removeLayer 里同步派发事件
            if (isQuiescing()) return;
            const pick = resolveFeaturePick({
              event,
              idKey: normalizeIdField(props.idKey),
              sentData: resource.sentData,
            });
            // 命中但认不出**身份**时必须说出来：`id` 是拾取与 Feature State 的唯一定位口径，
            // 静默给一个 null 会让使用者以为是 SDK 的问题。
            if (pick.hit && pick.id === null) {
              warnOnce(
                `${component}:pick-identity`,
                `[${component}] 命中了要素但认不出业务身份（载荷里的 \`id\` 为 null）：` +
                  (normalizeIdField(props.idKey) === undefined
                    ? "本组件没有声明 idKey ⇒ 无法知道哪个字段是业务 id" +
                      "（Feature State 与按 id 定位也会失败）"
                    : `当前 idKey="${String(normalizeIdField(props.idKey))}" 指向的字段不是有限数字 / 字符串`),
              );
            }
            options.emitPick?.(name, pick);
          }),
        );
      }
    },
  });

  return { resource };
}
