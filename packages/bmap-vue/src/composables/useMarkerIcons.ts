/**
 * useMarkerIcons —— 内置默认图标集
 *
 * 提供官方内置 marker 图标集（经 `client.driver.overlays.buildIcon` 构建，避免全局 SDK 依赖）。
 *
 * M5-SPEC-MARKER / #30：图标表搬到 `core/icons/markerIcon`（**单一事实源**）之后，这里只负责
 * 「名称 → Icon 实例」的构建。此前这份表与 Driver 里那份各写一遍，且 Driver 那份只有 7 个名字，
 * 于是另外 20 个内置名（`red1`~`red10` / `blue1`~`blue10`）在 `<Marker icon="...">` 上会静默
 * 渲染成 `simple_red` 的位置——现在两边读同一份数据，不可能再漂移。
 *
 * 这里刻意用**雪碧图**版本的 descriptor（`builtinMarkerIconDescriptor`）：这套图标的语义是
 * 「同一张雪碧图上的位置集合」，因此 `start` / `end` 与 `<Marker icon="start">`（走内联 SVG）
 * 可以不同——该差异在迁移前就存在，本次只收敛数据来源，不改变观感。
 *
 * **返回的每个 Icon 都是独立新建的**：本 hook 走的是**公共** `buildIcon`，而公共路径不共享
 * 有界 LRU 缓存持有的实例（该缓存只服务 Marker 的构造 / `setIcon`）——调用方可以安全地持有或
 * 修改拿到的对象，不会影响别处或后续调用（外部评审 P2 的隔离契约）。
 */
import { useOptionalMapContext } from "../core/context/inject";
import { useOptionalClientContext } from "../core/context/client";
import {
  BUILTIN_MARKER_ICON_NAMES,
  builtinMarkerIconDescriptor,
  type BuiltinMarkerIconName,
} from "../core/icons/markerIcon";

/**
 * 内置图标名的取值域。
 *
 * 这个名字属于 `./composables` 子入口的**既有公共 API**（此前由本文件自己声明、经
 * `composables/index.ts` 的 `export *` 暴露出去），因此这里必须继续导出；值本身改为从
 * 内置图标表派生（`types/components` 的 `MarkerIconName` 是同一个类型），不再手写第二份名单
 * ——外部评审 P1：删掉它会让 `import type { MarkerIconName } from 'bmap-vue/composables'`
 * 编译失败，而 consumer smoke 只覆盖了根入口。
 */
export type MarkerIconName = BuiltinMarkerIconName;

/**
 * 构建内置图标集合。
 * @param client BMapClient(经 map context ready 获取)
 * @returns 名称 → Icon 实例；**每个实例都是独立新建的**（公共 `buildIcon` 不共享缓存对象），
 *          调用方可以安全地持有 / 修改，重复调用返回的是新实例
 */
export function useMarkerIcons(
  client?: import("../client/types").BMapClient,
): Record<string, unknown> {
  const resolved =
    client ??
    useOptionalMapContext()?.client.value ??
    useOptionalClientContext()?.client.value ??
    undefined;
  if (!resolved) {
    throw new Error(
      "Map client is not ready. Call useMarkerIcons(client) after map ready.",
    );
  }
  const icons: Record<string, unknown> = {};
  for (const name of BUILTIN_MARKER_ICON_NAMES) {
    const descriptor = builtinMarkerIconDescriptor(name);
    icons[name] = resolved.driver.overlays.buildIcon({
      imageUrl: descriptor.imageUrl,
      size: { width: descriptor.width, height: descriptor.height },
      imageOffset: {
        x: descriptor.imageOffsetX ?? 0,
        y: descriptor.imageOffsetY ?? 0,
      },
      imageSize: {
        width: descriptor.imageSizeWidth ?? 0,
        height: descriptor.imageSizeHeight ?? 0,
      },
    });
  }
  return icons;
}
