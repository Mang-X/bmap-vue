/**
 * useCustomOverlay —— CustomOverlay 的宿主所有权（M5-CUSTOM-MENU / issue #33）
 *
 * 与 `useInfoWindow`（#32）**同构**的一层薄封装：覆盖物的创建 / 挂载 / 更新 / 重建 / 释放仍由
 * `useOverlaySpec` 驱动（本函数只是把 spec 与 props 接上去），这里多加的只有一件内核不该管的事 ——
 * **拥有那个 detached 宿主要素**。
 *
 * ## 宿主分工
 *
 * ```
 * useCustomOverlay ── 创建 host（一个 detached <div>）
 *        │
 *        ├─ createCustomOverlay(position, () => host)  ← SDK 只是「拿到并搬运」它
 *        └─ <Teleport :to="host">                      ← Vue 拥有 host 内部的渲染子树
 * ```
 *
 * 这条分工对应 issue 的非目标「不让 SDK 移动 Vue 原始管理节点」：SDK 搬的是**我们**创建的宿主
 * 元素，slot 里的节点始终由 Vue 渲染进宿主内部，SDK 永远不直接操作它们。
 *
 * **宿主一个组件一份、跨重建复用**（不是每代实例新建一个）：真实 4.0 的 `setPoint(point)`
 * 会重新调用业务 DOM 工厂，重建实例同理，而返回同一个宿主意味着 slot 子树在任何一条重建路径上
 * 都不被卸载重建，`<Teleport :to>` 的目标元素身份因此保持稳定。
 *
 * ## 为什么不用 `FrameScheduler` / `useResizeObserver`
 *
 * `CustomOverlay` 没有 `redraw()` 之类的重绘入口（`InfoWindow` **有**，所以 #32 才需要观察尺寸
 * 并合帧）。位置刷新由 SDK 自己的渲染循环负责（官方为此提供了构造选项 `synUpdate`），本库没有
 * 可下发的命令 ⇒ 没有可合帧的对象。凭空加一个「我们自己的重绘循环」属于自研官方没有的能力，
 * 理由记在 `customOverlaySpec.ts` 与 ADR `2026-09-19-custom-overlay-and-context-menu` 里。
 */
import { onScopeDispose, shallowRef, type ShallowRef } from "vue";
import { useOverlaySpec } from "./useOverlaySpec";
import { createCustomOverlaySpec } from "../../components/overlays/customOverlaySpec";
import type { CustomOverlayProps } from "../../types/components";

export interface UseCustomOverlayOptions {
  /** 组件的 `emit`（事件矩阵派发经它落地）。 */
  readonly emit: (name: string, payload: unknown) => void;
}

export interface UseCustomOverlayResult {
  /**
   * slot 的 Teleport 目标（`<Teleport :to="host">`）；实例未创建时为 `null`。
   *
   * 它**不是**「实例是否就绪」的读数：宿主在第一次 `create` 时就绪，而实例可以在之后的
   * `recreate` 里换掉，宿主保持不变。
   */
  readonly host: Readonly<ShallowRef<HTMLElement | null>>;
}

export function useCustomOverlay(
  props: Readonly<CustomOverlayProps>,
  options: UseCustomOverlayOptions,
): UseCustomOverlayResult {
  const host = shallowRef<HTMLElement | null>(null);

  /**
   * 惰性创建宿主。
   *
   * 创建点必须是**第一次 create**（即 `onMounted` 之后），而不是 `setup` 期：SSR 没有 `document`，
   * `setup` 期碰它会让「import 无副作用、SSR 可渲染」这条约定失效。`<CustomOverlay>` 的模板用
   * `v-if="host"` 把 Teleport 挡在 SSR 之外，两侧因此一致。
   */
  function ensureHost(): HTMLElement {
    if (!host.value) {
      const element = document.createElement("div");
      // 开放的 DOM 契约：外部据此定位「被 SDK 搬运的那块宿主」（与 `data-bmap-infowindow-content` 同一手法）
      element.setAttribute("data-bmap-custom-overlay", "");
      host.value = element;
    }
    return host.value;
  }

  useOverlaySpec(props, createCustomOverlaySpec({ ensureHost }), { emit: options.emit });

  onScopeDispose(() => {
    // 宿主由本作用域拥有：先把它从文档里摘掉（SDK 侧的正常路径已经摘过一次，这里是兜底——
    // 万一 `removeOverlay` 失败，也不会留一块我们的节点在地图容器里），再释放引用。
    host.value?.remove();
    host.value = null;
  });

  return { host: host as Readonly<ShallowRef<HTMLElement | null>> };
}
