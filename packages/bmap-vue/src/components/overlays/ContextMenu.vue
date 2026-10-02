<script setup lang="ts">
/**
 * ContextMenu —— 右键菜单（M5-CUSTOM-MENU / issue #33）
 *
 * 两种写法，一份条目：
 *
 * ```vue
 * <!-- 数据 API -->
 * <ContextMenu :items="[{ text: '标记此处', callback: onMark }, '-', { text: '删除', disabled }]" />
 *
 * <!-- 声明式 API -->
 * <ContextMenu>
 *   <MenuItem text="标记此处" @select="onMark" />
 *   <MenuSeparator />
 *   <MenuItem text="删除" disabled />
 * </ContextMenu>
 * ```
 *
 * 组件只做三件事：把 `props` 交给内核、provide 声明式子组件的注册表、把声明式 children 渲染到一个
 * **detached 宿主**里（因此它们不占地图容器的 DOM）。生命周期、target 迁移、事件全部在
 * `useContextMenu` 里。
 *
 * ## target（v4 实测结论）
 *
 * 菜单挂到**最近的 TargetContext**：
 *
 * | 位置 | 目标 | SDK 入口 |
 * | --- | --- | --- |
 * | 直接写在 `<Map>` 下 | `map` | `Map#addContextMenu(menu)` |
 * | 写在 `<Marker>` 里 | `marker` | `Marker#addContextMenu(menu)`（**运行时扩展**，类型包未声明） |
 *
 * 「挂到 marker」这条曾经被当作 v4 不存在（#33 之前的行为是显式拒绝），真实 AK 实测推翻了它：
 * `Marker#addContextMenu` / `#removeContextMenu` 在 4.0 运行时存在且可用（挂上后右键该标注会派发
 * 菜单的 `open`，`removeContextMenu` 之后同样的右键不再 `open`）。依据与读数见 ADR
 * `2026-09-19-custom-overlay-and-context-menu`。
 *
 * `overlay` / `clusterer` 等其它目标**没有入口证据**，会被显式拒绝（**不**回退到地图）。
 *
 * ## `open` / `close` 不是受控状态
 *
 * 它们只是 SDK 的观测事件（用户右键打开、选中或点击别处关闭）。本库**不**把它们升级成
 * `v-model:open`：官方没有可靠的打开状态读回，也没有「在指定位置打开」的公开入口，做成受控状态
 * 就必须去猜「这条回包属于哪次命令」。选中走 `select`（本库事件，源自 `MenuItem` 的回调）。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useContextMenu } from "../../core/composables/useContextMenu";
import { useRequiredMapContext } from "../../core/context/inject";
import type { BMapError } from "../../core/errors/BMapError";
// #138：事件面的类型声明是生成物（见 `scripts/generate-overlay-emits.mts`）；`select` 的载荷
// 仍是本库类型（不是 SDK 事件），生成器从非 SDK 事件表里带出来。
import type { ContextMenuEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { ContextMenuProps } from "../../types/components";

export type { ContextMenuProps };

const props = withDefaults(defineProps<ContextMenuProps>(), {
  // `width: 100` 是默认值（也是文档里的值）。曾经漏掉它 ⇒ Driver 拿到 `undefined`，
  // 而 `width` 是**每项的构造期输入**（`MenuItemOptions.width`），行为与文档分叉（复审 P4）。
  width: 100,
  // `items` **不给运行期默认值**：菜单的「空」与「没传」在行为上同义（空菜单不会被挂上），
  // 给一个 `() => []` 的默认值只会让「父级还没算好数据」与「父级真的要空菜单」变得不可区分。
  visible: true,
});

const emit = defineEmits<ContextMenuEmits>();

const emitDynamic = dynamicEmit(emit);
const ctx = useRequiredMapContext();

const { itemsHost, commands } = useContextMenu(props, {
  emit: emitDynamic,
  /** 失败统一走组件既有的 `resource:error` 诊断通道（与其它覆盖物一致）。 */
  reportError: (error: BMapError) => {
    try {
      ctx.events.emit("resource:error", { error, component: "ContextMenu" });
    } catch {
      /* 事件总线已停用时不再追究 */
    }
  },
});

/**
 * 插槽契约（#188）。
 *
 * `defineSlots` 在这里不是可选的文档，而是**发布声明能否成立的前提**：不写它时
 * `vue-tsc` 会把插槽载荷 emit 成模块局部的 `declare var __VLS_1: {}`，
 * 而声明打包阶段（API Extractor rollup）只保留导出面可达的符号，那条 `var`
 * 会连同它的声明一起消失，留下一个对 `__VLS_1` 的 `typeof` **悬空引用** ——
 * 消费方开 `skipLibCheck: false` 立刻报 `TS2304`。
 * 写了它之后 Volar 把载荷**内联**进 `__VLS_Slots`，全程没有中间 `var`。
 * 详见 `components/map/Map.vue` 里同段注释（根因与实验记录都在那里）。
 *
 * 载荷是**空对象类型**而不是 `any`：本组件的内容插槽不传任何东西，
 * 写成 `any` 等于把插槽类型面放宽成「无推导」。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<string, never>): any;
}>();
defineOptions({ name: "ContextMenu" });

/**
 * 逐条命令面（#165 Class 3 / TASK 2d/2e）。
 *
 * - `getItem(index)` / `removeItem(index)` / `removeSeparator(index)` / `getDom()` /
 *   `show()` / `hide()`：官方 `context-menu/ContextMenu.d.ts` 的六个成员；
 * - `setItemText` / `setItemEnabled`：官方 `MenuItem#setText` / `#enable` / `#disable`，
 *   经菜单 + 序号下发（官方 `ContextMenu` **没有**「拿到第 i 条再改」的入口，而它的
 *   `getItem` 返回 raw 对象，组件面不得持有）。
 *
 * **刻意不交出 raw `MenuItem`**：AGENTS.md 的 raw SDK 白名单不含组件与 `core`，
 * 且官方 `MenuItem` 上**没有任何 getter**（只有 `setText` / `enable` / `disable`）——
 * 交出去对调用方是全盲的。出入参一律按**序号** + 本库条目模型。
 *
 * 释放 / 未就绪时**显式抛 `BMAP_RESOURCE_DISPOSED`**（逐条依据见
 * `core/composables/useContextMenu.ts` 的 `requireMenu`）。
 */
defineExpose(commands);
</script>

<template>
  <!--
    声明式 children 渲染到 detached 宿主：`<MenuItem>` / `<MenuSeparator>` 因此能被挂载
    （从而把自己登记给菜单）却不出现在地图容器的 DOM 里。SSR 下 `itemsHost` 为 `null`，
    子组件不渲染——与 `<CustomOverlay>` / `<InfoWindow>` 同一口径。
  -->
  <Teleport v-if="itemsHost" :to="itemsHost">
    <slot />
  </Teleport>
</template>
