import { describe, expect, it } from "vitest";
import {
  BUILTIN_MARKER_ICON_NAMES,
  MARKER_ICON_SPRITE_SIZE,
  MARKER_ICON_SPRITE_URL,
  builtinMarkerIconDescriptor,
  isBuiltinMarkerIconName,
  resolveMarkerIconDescriptor,
} from "./markerIcon";
import { iconCacheKey } from "./iconCache";
import type { MarkerIconName } from "../../types/components";

describe("内置图标名清单", () => {
  it("与公开类型 MarkerIconName 完全一致（双向，不是单向可赋值）", () => {
    // 类型层：把差集显式取出来并要求它是 never —— 上游/本库任一侧改了名字都会编译失败
    type BuiltinOnly = Exclude<MarkerIconName, (typeof BUILTIN_MARKER_ICON_NAMES)[number]>;
    type DeclaredOnly = Exclude<(typeof BUILTIN_MARKER_ICON_NAMES)[number], MarkerIconName>;
    const noBuiltinOnly: BuiltinOnly[] = [];
    const noDeclaredOnly: DeclaredOnly[] = [];
    expect(noBuiltinOnly).toEqual([]);
    expect(noDeclaredOnly).toEqual([]);

    // 运行期：逐项点名（类型层断言不参与运行时，改名后仍要有一条会红的检查）
    expect([...BUILTIN_MARKER_ICON_NAMES].sort()).toEqual(
      [
        "simple_red", "simple_blue", "loc_red", "loc_blue", "start", "end", "location",
        "red1", "red2", "red3", "red4", "red5", "red6", "red7", "red8", "red9", "red10",
        "blue1", "blue2", "blue3", "blue4", "blue5", "blue6", "blue7", "blue8", "blue9", "blue10",
      ].sort(),
    );
    expect(BUILTIN_MARKER_ICON_NAMES).toHaveLength(27);
  });

  it("每个内置名都能解析出雪碧图上的位置（不再有 20 个名字回落 simple_red）", () => {
    const descriptors = BUILTIN_MARKER_ICON_NAMES.map((name) => builtinMarkerIconDescriptor(name));
    for (const descriptor of descriptors) {
      expect(descriptor.imageUrl).toBe(MARKER_ICON_SPRITE_URL);
      expect(descriptor.width).toBeGreaterThan(0);
      expect(descriptor.height).toBeGreaterThan(0);
      expect(descriptor.imageSizeWidth).toBe(MARKER_ICON_SPRITE_SIZE);
      expect(descriptor.imageOffsetX).toBeGreaterThanOrEqual(0);
    }
    // 旧实现里 `red5` 会落到 simple_red 的位置（[454,378]）；这里必须落在它自己的格子上
    const red5 = builtinMarkerIconDescriptor("red5");
    const simpleRed = builtinMarkerIconDescriptor("simple_red");
    expect(red5.imageOffsetX).not.toBe(simpleRed.imageOffsetX);
    expect(red5).toMatchObject({ imageOffsetX: 76, imageOffsetY: 0, width: 19, height: 19 });
    // `location` 是 `loc_red` 的别名（同一格），这是历史行为
    expect(builtinMarkerIconDescriptor("location")).toEqual(
      builtinMarkerIconDescriptor("loc_red"),
    );
  });
});

describe("resolveMarkerIconDescriptor", () => {
  it("内置名：start / end 走内联 SVG 覆盖（Driver 侧历史行为，含锚点）", () => {
    const start = resolveMarkerIconDescriptor("start");
    expect(start.imageUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(start).toMatchObject({ width: 24, height: 32, anchorX: 12, anchorY: 16 });
    // 与「整套内置图标」用的雪碧图版本刻意不同（两处语义不同，见模块注释）
    expect(builtinMarkerIconDescriptor("start").imageUrl).toBe(MARKER_ICON_SPRITE_URL);
  });

  it("未知名字回落 simple_red（只可能来自 JS / any 调用方）", () => {
    expect(resolveMarkerIconDescriptor("no_such_icon")).toEqual(
      resolveMarkerIconDescriptor("simple_red"),
    );
  });

  it("自定义描述：逐字段投影，且与键序无关", () => {
    const descriptor = resolveMarkerIconDescriptor({
      imageUrl: "https://example.com/a.png",
      size: { width: 30, height: 40 },
      anchor: { x: 15, y: 40 },
      imageOffset: { x: 60, y: 0 },
      imageSize: { width: 90, height: 90 },
    });
    expect(descriptor).toEqual({
      imageUrl: "https://example.com/a.png",
      width: 30,
      height: 40,
      anchorX: 15,
      anchorY: 40,
      imageOffsetX: 60,
      imageOffsetY: 0,
      imageSizeWidth: 90,
      imageSizeHeight: 90,
    });

    // 「同配置 ⇒ 同 key」（缓存命中的前提）：对象键序不影响 key
    expect(iconCacheKey(descriptor)).toBe(
      iconCacheKey(
        resolveMarkerIconDescriptor({
          imageSize: { height: 90, width: 90 },
          imageOffset: { y: 0, x: 60 },
          anchor: { y: 40, x: 15 },
          size: { height: 40, width: 30 },
          imageUrl: "https://example.com/a.png",
        }),
      ),
    );
    // 任何一个字段不同都要换 key
    expect(iconCacheKey(descriptor)).not.toBe(
      iconCacheKey(resolveMarkerIconDescriptor({ imageUrl: "https://example.com/a.png", size: { width: 30, height: 41 } })),
    );
  });

  it("isBuiltinMarkerIconName 只认清单里的名字", () => {
    expect(isBuiltinMarkerIconName("red7")).toBe(true);
    expect(isBuiltinMarkerIconName("toString")).toBe(false);
    expect(isBuiltinMarkerIconName("")).toBe(false);
  });
});
