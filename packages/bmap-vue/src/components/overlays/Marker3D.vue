<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { OverlayHandle } from "../../driver/types/handles";

/**
 * Marker3D 迁移(adapter 模式)
 *
 * position/icon 更新走字段级 setter;height/size/fill 等属性同步。
 */
/**
 * `<Marker3D icon>` 的自定义纹理贴图描述。
 *
 * ⚠️ **没有** `printImageUrl`（issue #177）：上游 `IconOptions`（4.0.5）只有 `anchor` /
 * `imageOffset` / `imageSize` 三个键，这个字段此前声明了却永远不生效。
 */
export interface Marker3dCustomIcon {
  anchor?: { x: number; y: number };
  imageOffset?: { x: number; y: number };
  imageSize: { width: number; height: number };
  imageUrl: string;
}
export type Marker3dShape = "BMAP_SHAPE_CIRCLE" | "BMAP_SHAPE_RECT";

export interface Marker3DProps {
  position: { lng: number; lat: number };
  height: number;
  size?: number;
  shape?: Marker3dShape;
  fillColor?: string;
  fillOpacity?: number;
  icon?: Marker3dCustomIcon;
  enableMassClear?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<Marker3DProps>(), {
  size: 50,
  shape: "BMAP_SHAPE_CIRCLE",
  fillColor: "#f00",
  fillOpacity: 0.8,
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  mousedown: [e: unknown];
  mouseup: [e: unknown];
  mouseout: [e: unknown];
  mouseover: [e: unknown];
  remove: [e: unknown];
  rightclick: [e: unknown];
}>();

const { resource } = useOverlayResource<Marker3DProps, OverlayHandle>(
  props,
  {
    create: (ctx, p) =>
      ctx.client.driver.overlays.createMarker3D(p.position, p.height, {
        size: p.size,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        shape: p.shape,
        icon: p.icon,
        enableMassClear: p.enableMassClear,
      }),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      const on = (name: string, h: (e: unknown) => void) => {
        scope.add(ctx.client.driver.events.on(res, name, h));
      };
      on("click", (e) => emit("click", e));
      on("dblclick", (e) => emit("dblclick", e));
      on("mousedown", (e) => emit("mousedown", e));
      on("mouseup", (e) => emit("mouseup", e));
      on("mouseout", (e) => emit("mouseout", e));
      on("mouseover", (e) => emit("mouseover", e));
      on("remove", (e) => emit("remove", e));
      on("rightclick", (e) => emit("rightclick", e));
    },
    createWatchers(getCtx, getResource, p) {
      watch(
        () => p.position,
        (pos) => {
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          if (pos && typeof pos.lng === "number") ctx.client.driver.overlays.setPosition(res, pos);
        },
        { flush: "sync" },
      );
      watch(
        () => p.height,
        (h) => {
          const r = getResource();
          const ctx = getCtx();
          if (r && ctx) ctx.client.driver.overlays.setOptions(r, { height: h });
        },
      );
      watch(
        () => p.fillColor,
        (c) => {
          const _v = c;
          if (_v !== undefined) {
            const x = getResource();
            const ctx = getCtx();
            if (x && ctx) ctx.client.driver.overlays.setOptions(x, { fillColor: _v });
          }
        },
      );
      watch(
        () => p.fillOpacity,
        (o) => {
          const _v = o;
          if (_v !== undefined) {
            const x = getResource();
            const ctx = getCtx();
            if (x && ctx) ctx.client.driver.overlays.setOptions(x, { fillOpacity: _v });
          }
        },
      );
      watch(
        () => p.icon,
        (icon) => {
          const res = getResource();
          const ctx = getCtx();
          if (res && ctx && icon) ctx.client.driver.overlays.setOptions(res, { icon });
        },
      );
      watch(
        () => p.enableMassClear,
        (en) => {
          const r = getResource();
          const ctx = getCtx();
          if (r && ctx) ctx.client.driver.overlays.setOptions(r, { enableMassClear: en });
        },
      );
      watch(
        () => p.visible,
        (visible) => {
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const overlays = ctx.client.driver.overlays;
          const target = { kind: "map" as const, handle: ctx.map };
          if (visible) overlays.add(target, res);
          else overlays.remove(target, res);
        },
      );
    },
    remove: (res, ctx) => removeOverlay(res, ctx),
  },
  "marker3d",
);

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
 *
 * 刻意用 `Record<never, never>` 而不是更常见的 `Record<string, never>`（#188 评审 P1）：
 * 后者带**字符串索引签名**，于是消费方写错插槽 prop 时 `const { typo } = props`
 * **不报错**（`typo` 只是 `never`，而 `never` 又可赋给任何目标），错误成员静默通过 ——
 * 与 #188 要恢复的「错误成员有预期诊断」正好相反。实测见
 * `fixtures/consumer/strict/probe.ts` 里的 `HasStringIndex` 判据。`Record<never, never>` 与 `{}`
 * 同样没有索引签名，`typo` 会真的报 `TS2339`；两者都是合法的 `defineSlots` 载荷。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "Marker3D" });
</script>

<template>
  <slot />
</template>
