<script setup lang="ts">
/**
 * PlaceDetail —— 官方 UI Kit `PlaceDetail` 的 Vue 薄封装（UIKIT-02 / issue #75）
 *
 * 只做三件事：host 容器、构造前提（Map ready）、props → 已验证的 setPlace/clear 与事件 DTO。
 * 详情面板本身（图片、标题、评分、营业时间、电话、标签、外链等）全部由
 * `@baidumap/jsapi-ui-kit` 渲染。
 *
 * 刻意不做：
 * - **不暴露 `layout`**。上游 `PlaceDetailOptions` 里声明了 `layout?: 'default' | 'compact'`，
 *   但锁定版本 `1.1.2` 的产物里**没有任何读取点**（`layout` / `compact` 在 ESM 与 IIFE 两个
 *   产物里出现 0 次）。传了不生效 = 假支持，所以本库宁可不暴露；这条由
 *   `v3-ui-kit-widget-contract.test.ts` 对着发布产物锁定，上游真做出来时它会先红。
 * - **不合成 error 事件**。上游 `fetchDetailByUid()` 没有 `catch`，它返回的 Promise 被丢弃，
 *   请求失败不会经过任何事件出口（页面里只会看到一条 unhandled rejection）。本库不伪造一个
 *   「看起来收到了错误」的信号；要判断是否加载成功请看 `load` 事件是否到达（含超时兜底）。
 * - **不 querySelector 上游内部 DOM**：那是对上游内部结构的隐式依赖。
 *
 * 两类输入（口径与官方 react-bmap 的 `ctorKey` 一致）：
 * - **构造期选项**（`display`）：上游没有对应 setter，**变更即重建 widget**，不静默保留旧值；
 * - **`uid`**：上游构造器不吃它，只能靠 `setPlace()` 设置 —— 属于**运行期**输入，
 *   走 setter 镜像（`uid` 变回未设置时用 `clear()`，这在锁定版本上是有明确定义的公开方法）。
 *
 * `uid` 与 `setPlace()` 的边界：声明式 `uid` 是「这个面板展示哪个地点」的单一来源，
 * 重建时以 `uid` 为准；如果需要展示上游 POI 对象（而非 uid），请只用命令式 `setPlace()`，
 * 不要同时给 `uid` prop，否则重建会把面板拉回 prop 指定的地点。
 */
import { ref, watch } from "vue";
import { useUiKitWidget } from "../useUiKitWidget";
import { toPlaceDetailDTO } from "../points";
import type {
  PlaceDetailDTO,
  PlaceDetailDisplayDTO,
  PlaceDetailPlaceInput,
  UiKitPlaceDetailWidget,
} from "../types";

export interface PlaceDetailProps {
  /** 要展示的 POI uid；不传 / 传 `undefined` 时面板停在空状态占位。运行期可改（走 `setPlace()` / `clear()`）。 */
  uid?: string;
  /** 详情字段显隐。构造期选项，变更会重建 widget。 */
  display?: PlaceDetailDisplayDTO;
}

const props = withDefaults(defineProps<PlaceDetailProps>(), {});

const emit = defineEmits<{
  /** 详情加载完成（uid 模式）或本地渲染完成（POI 模式） */
  load: [detail: PlaceDetailDTO];
}>();

/** 构造期选项的键名表（单一来源：`buildOptions()` 由它取值，桥按同一份内容判断是否重建）。 */
const CONSTRUCTOR_OPTION_KEYS = ["display"] as const satisfies readonly (keyof PlaceDetailProps)[];

/**
 * 构造期选项：只透传「显式给过」的（把 `undefined` 也传下去会覆盖上游自己的默认值），
 * 并且按**内容**（而不是对象引用）决定是否重建 —— 桥用排序序列化保证内容相同的内联
 * 对象字面量不会触发重建风暴。
 */
function buildOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of CONSTRUCTOR_OPTION_KEYS) {
    const value = props[key];
    if (value !== undefined) options[key] = value;
  }
  return options;
}

const hostRef = ref<HTMLElement | null>(null);

const { widget, status, withWidget } = useUiKitWidget<UiKitPlaceDetailWidget>({
  component: "PlaceDetail",
  host: hostRef,
  buildOptions,
  // 构造期选项（上游没有 setter）：内容变化由桥重建 widget。
  constructorOptions: buildOptions,
  create: (module, host, options) => new module.PlaceDetail(host, options),
  bind: () => [
    {
      event: "load",
      handler: (...args: unknown[]) => {
        const detail = toPlaceDetailDTO(args[0]);
        // 形状不认识就不发：不制造「看起来加载好了」的假信号。
        if (detail) emit("load", detail);
      },
    },
  ],
});

// 构造期输入变化 → 重建由桥负责（`constructorOptions`）。

/**
 * 每个 widget 实例已经应用过的 uid。
 *
 * `uid` 不是构造期选项（上游构造器只吃 `map` / `display`），所以构造完成后必须补一次
 * `setPlace()` —— 而「构造完成」不是 props 变化，只 watch `uid` 会在「挂载时就带 uid」
 * 这个最常见的情形下漏掉。因此 watch 的是 `[widget, uid]` 组合：widget 从 `null` 变成实例
 * （首次构造 / 重建完成）时也会触发。
 *
 * widget 换实例（重建）或被释放时必须清零：新 widget 是空的，得重新 `setPlace()`。
 */
let appliedUid: string | undefined;

watch(
  [() => widget.value, () => props.uid] as const,
  ([instance, uid]) => {
    if (!instance) {
      appliedUid = undefined;
      return;
    }
    if (uid === undefined) {
      // 只有「刚刚还在展示某个地点」才需要清空：构造出来本来就是空状态占位，不必多调一次。
      if (appliedUid !== undefined) {
        appliedUid = undefined;
        instance.clear();
      }
      return;
    }
    if (appliedUid === uid) return;
    appliedUid = uid;
    // 字符串入参走上游的 `fetchDetailByUid()`（async，同步不会抛）；请求结果由 `load` 事件交回。
    instance.setPlace(uid);
  },
);

/** 设置当前展示的地点：uid，或上游能渲染的 POI 对象（原样转发，见 `PlaceDetailPlaceInput`）。 */
function setPlace(uidOrPoi: PlaceDetailPlaceInput): Promise<void> {
  return withWidget((instance) => instance.setPlace(uidOrPoi));
}

/** 清空详情区域，恢复空状态占位。 */
function clear(): Promise<void> {
  return withWidget((instance) => instance.clear());
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
  setPlace,
  clear,
});

defineOptions({ name: "PlaceDetail" });
</script>

<template>
  <!-- host 只提供挂载点：详情面板的 DOM 全部由官方 UI Kit 渲染。 -->
  <div ref="hostRef" class="b-place-detail"></div>
</template>
