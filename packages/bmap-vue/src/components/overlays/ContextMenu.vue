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
  // `width: 100` 是 v3 起的默认值（也是文档里的值）。M5 重写时漏掉了它 ⇒ Driver 拿到 `undefined`，
  // 而 `width` 是**每项的构造期输入**（`MenuItemOptions.width`），行为与 v3 分叉（复审 P4）。
  width: 100,
  // `items` 与旧名 `menuItems` 都**不给运行期默认值**：集中弃用层的「新 API 优先」判据是
  // 「正典值是不是 `undefined`」，给一个 `() => []` 的默认值会让旧名永远读不到
  // （与 `InfoWindow` 的 `show` 落在同一类取舍上，见 InfoWindowSpec 的说明）。
  visible: true,
});

const emit = defineEmits<ContextMenuEmits>();

const emitDynamic = dynamicEmit(emit);
const ctx = useRequiredMapContext();

const { itemsHost } = useContextMenu(props, {
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

defineOptions({ name: "ContextMenu" });
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
