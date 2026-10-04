<script setup lang="ts">
import { watch } from "vue";
import type { MapMaskShowRegion } from "../../types/components";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { OverlayHandle } from "../../driver/types/handles";

/**
 * MapMask 迁移(adapter 模式)
 *
 * points 视为不可变值,更新后替换根引用触发;支持 pathVersion 强制刷新。
 *
 * 坐标数组叫 `points`（#165 Class 1）：官方类型包**没有** `MapMask` 的类声明（真实 4.0
 * 运行时才有构造器，见 `createMapMask` 的注释），因此没有 d.ts 形参名可对；但它接收的是
 * 与 `Polyline` / `Polygon` 同形的点数组，跟随那四个图形族覆盖物一起改成 `points`，
 * 免得同一个概念在五个组件上有两个名字。
 */
export interface MapMaskProps {
  points: { lng: number; lat: number }[];
  pathVersion?: string | number;
  showRegion?: MapMaskShowRegion;
  isBuildingMask?: boolean;
  isMapMask?: boolean;
  isPoiMask?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<MapMaskProps>(), {
  showRegion: "inside",
  isBuildingMask: false,
  isMapMask: false,
  isPoiMask: false,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  mousedown: [e: unknown];
  mouseup: [e: unknown];
  mouseout: [e: unknown];
  mouseover: [e: unknown];
  rightclick: [e: unknown];
}>();

const { resource, rebuild } = useOverlayResource<MapMaskProps, OverlayHandle>(
  props,
  {
    create: (ctx, p) => {
      if (!p.points?.length) throw new Error("MapMask points is required");
      return ctx.client.driver.overlays.createMapMask(p.points, {
        showRegion: p.showRegion,
        isBuildingMask: p.isBuildingMask,
        isMapMask: p.isMapMask,
        isPoiMask: p.isPoiMask,
      });
    },
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
      on("rightclick", (e) => emit("rightclick", e));
    },
    createWatchers(getCtx, getResource, p) {
      // SDK MapMask 不可变(points 只能构造时传入)。points 更新由使用方
      // 通过 pathVersion 变化触发重建(见下方)。
      // 注意:不能在此处用 watch 重建,否则初始挂载会重复创建。
      watch(
        [() => p.points, () => p.pathVersion],
        ([points]) => {
          if (points?.length && !getResource()) void rebuild();
        },
        { flush: "sync" },
      );
      // 掩膜选项构造期生效：变化时重建（SDK setOptions 不保证刷新已挂载掩膜）
      for (const key of ["showRegion", "isBuildingMask", "isMapMask", "isPoiMask"] as const) {
        watch(
          () => p[key],
          (value, old) => {
            if (value === old) return;
            if (!getResource()) return;
            void rebuild();
          },
        );
      }
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
  "mapmask",
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
 * 同样没有索引签名，`typo` 会真的报 `TS2339`，而 Volar 对两者的 emit 完全一致。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "MapMask" });
</script>

<template>
  <slot />
</template>
