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

defineOptions({ name: "MapMask" });
</script>

<template>
  <slot />
</template>
