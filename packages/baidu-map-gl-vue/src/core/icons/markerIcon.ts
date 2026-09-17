/**
 * Marker 图标：**descriptor 归一化 + 内置图标单一事实源**（M5-SPEC-MARKER / issue #30）
 *
 * ## 为什么内置图标表要搬到 `core`
 *
 * 同一份「内置图标名 → 雪碧图偏移」的表此前存在**两份**：一份在
 * `driver/jsapi-v4/overlays.ts`（7 个名字 + `start`/`end` 的两个 data URL 覆盖），一份在
 * `composables/useBMapMarkerIcons.ts`（27 个名字）。而 `BMarkerProps.icon` 的类型
 * （`types/components.ts` 的 `MarkerIconName`）认的是 **27 个**名字 —— 于是另外 20 个名字走到
 * Driver 时落进「未知名字」的兜底分支，**静默渲染成 `simple_red` 的雪碧图位置**。
 *
 * 现在表只有一份（本文件），两侧都从这里读：`useBMapMarkerIcons` 取雪碧图条目，
 * Driver 取「data URL 覆盖优先、雪碧图兜底」的完整解析结果。
 *
 * ## `BMap.Icons` 的处置（issue 原文提到的「`BMap.Icons` adapter」）
 *
 * **不用它**，理由是它在本引擎没有声明的运行时入口：
 *
 * - `@baidumap/jsapi-v4-types@4.0.4` 里**没有** `Icons` 这个成员（`overlay/` 目录只有
 *   `Icon.d.ts` / `IconOptions.d.ts` 与 `IconSequence.d.ts`，`index.d.ts` 的三斜线引用里也没有它）；
 * - 官方 JSAPI 4.0 API 参考的覆盖物章节里同样没有它（`BMap.Icon` 有独立页面）。
 *
 * 按本仓库的边界规则（`AGENTS.md` 的 official-first 一节）：「上游没有的能力」不得靠就地
 * augmentation 或结构性探测去「补齐」。这里实现的是**官方声明的等价面** `BMap.Icon`
 * （`Icon` 的 `setImageUrl` / `setSize` / `setImageSize` / `setAnchor` / `setImageOffset`
 * 在官方声明与参考里都有），adapter 的职责收窄成「领域 descriptor → `BMap.Icon` 构造参数」。
 */
import { normalizeIconDescriptor, type IconDescriptor } from "./iconCache";

/** 内置图标使用的雪碧图（与线上 `<BMarker icon="simple_red">` 的历史观感一致）。 */
export const MARKER_ICON_SPRITE_URL =
  "https://mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png";

/** 雪碧图逻辑尺寸（HD 图实际为 600×600，逻辑按一半使用）。 */
export const MARKER_ICON_SPRITE_SIZE = 300;

/**
 * 内置图标在雪碧图上的原始位置：`name → [offsetX, offsetY, width, height]`（HD 图像素，
 * 使用时要除以 {@link MARKER_ICON_HD_SCALE}）。
 */
const MARKER_ICON_SPRITES = {
  simple_red: [454, 378, 42, 66],
  simple_blue: [454, 450, 42, 66],
  loc_red: [400, 378, 46, 70],
  loc_blue: [400, 450, 46, 70],
  start: [298, 450, 46, 70],
  end: [298, 378, 46, 70],
  location: [400, 378, 46, 70],
  red1: [0, 0, 38, 38],
  red2: [38, 0, 38, 38],
  red3: [76, 0, 38, 38],
  red4: [114, 0, 38, 38],
  red5: [152, 0, 38, 38],
  red6: [190, 0, 38, 38],
  red7: [228, 0, 38, 38],
  red8: [266, 0, 38, 38],
  red9: [304, 0, 38, 38],
  red10: [342, 0, 38, 38],
  blue1: [0, 38, 38, 38],
  blue2: [38, 38, 38, 38],
  blue3: [76, 38, 38, 38],
  blue4: [114, 38, 38, 38],
  blue5: [152, 38, 38, 38],
  blue6: [190, 38, 38, 38],
  blue7: [228, 38, 38, 38],
  blue8: [266, 38, 38, 38],
  blue9: [304, 38, 38, 38],
  blue10: [342, 38, 38, 38],
} as const;

/** HD 雪碧图 → 逻辑像素的缩放（图是 2x）。 */
export const MARKER_ICON_HD_SCALE = 2;

export type BuiltinMarkerIconName = keyof typeof MARKER_ICON_SPRITES;

/** 内置图标名清单（顺序与声明顺序一致，供 `useBMapMarkerIcons` 与文档使用）。 */
export const BUILTIN_MARKER_ICON_NAMES = Object.keys(
  MARKER_ICON_SPRITES,
) as BuiltinMarkerIconName[];

/**
 * 个别内置名**不用雪碧图**，改用内联 SVG（历史行为，`<BMarker icon="start">` 的观感依赖它）。
 *
 * 与雪碧图条目分开存放：`useBMapMarkerIcons` 返回的是雪碧图版本（它给的是「一整张图上的
 * 图标集」），而 Driver 的 `buildIcon` 优先用这里的覆盖。这个差异在迁移前就存在，本次**不改变**它
 * ——只把两份表合成一份，去掉「20 个名字静默回落」这个真实缺陷。
 */
const BUILTIN_MARKER_ICON_URL_OVERRIDES: Partial<
  Record<BuiltinMarkerIconName, { readonly imageUrl: string; readonly width: number; readonly height: number }>
> = {
  start: {
    imageUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%231677ff' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
    width: 24,
    height: 32,
  },
  end: {
    imageUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%23f04444' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
    width: 24,
    height: 32,
  },
};

/**
 * 领域图标输入（结构自持：不 import Driver 的类型包，调用方结构兼容即可）。
 *
 * 与 `driver/types/overlays` 的 `MarkerIconInput` 同形；`types/components` 的 `MarkerIcon` 也同形。
 *
 * 刻意写成 `type` 而不是 `interface`：`normalizeIconDescriptor()` 的入参是
 * `Partial<IconDescriptor> & Record<string, unknown>`，而只有**类型别名**才有隐式索引签名
 * （interface 没有），写成 interface 会让调用方被迫多写一次断言。
 */
export type MarkerIconInputLike = {
  imageUrl: string;
  size: { width: number; height: number };
  anchor?: { x: number; y: number };
  imageOffset?: { x: number; y: number };
  imageSize?: { width: number; height: number };
};

/** 内置图标名判定（`MarkerIconName` 是封闭联合，但 JS / `any` 调用方可能传别的字符串）。 */
export function isBuiltinMarkerIconName(name: string): name is BuiltinMarkerIconName {
  return Object.prototype.hasOwnProperty.call(MARKER_ICON_SPRITES, name);
}

/** 雪碧图偏移 → 逻辑像素的 descriptor 片段。 */
function spriteDescriptor(name: BuiltinMarkerIconName): IconDescriptor {
  const [offsetX, offsetY, width, height] = MARKER_ICON_SPRITES[name];
  return {
    imageUrl: MARKER_ICON_SPRITE_URL,
    width: width / MARKER_ICON_HD_SCALE,
    height: height / MARKER_ICON_HD_SCALE,
    imageOffsetX: offsetX / MARKER_ICON_HD_SCALE,
    imageOffsetY: offsetY / MARKER_ICON_HD_SCALE,
    imageSizeWidth: MARKER_ICON_SPRITE_SIZE,
    imageSizeHeight: MARKER_ICON_SPRITE_SIZE,
  };
}

/**
 * 内置图标在**雪碧图**上的 descriptor（**不**应用 {@link BUILTIN_MARKER_ICON_URL_OVERRIDES}）。
 *
 * 用途是「一次性拿到整套内置图标」的场景（`useBMapMarkerIcons` 返回的名称 → Icon 映射）：
 * 那套图标的语义是「同一张雪碧图上的 27 个位置」，因此 `start` / `end` 在这里也是雪碧图版本。
 * 单个 `<BMarker icon="start">` 走 {@link resolveMarkerIconDescriptor}，会用 data URL 覆盖。
 */
export function builtinMarkerIconDescriptor(name: BuiltinMarkerIconName): IconDescriptor {
  return spriteDescriptor(name);
}

/** 未知内置名（只可能来自 JS / `any` 调用方）的兜底：与迁移前的行为一致。 */
const FALLBACK_BUILTIN_ICON_NAME: BuiltinMarkerIconName = "simple_red";

/**
 * 把领域图标输入归一化为**可比较、可缓存**的 descriptor。
 *
 * - 字符串：内置名（未知名字按 {@link FALLBACK_BUILTIN_ICON_NAME} 兜底，调用方应当先经
 *   {@link isBuiltinMarkerIconName} 判定并告警）；
 * - 对象：自定义图标描述（`size` 必填，其余可选）。
 *
 * 返回值的字段顺序与 {@link import("./iconCache").iconCacheKey} 的序列化顺序一致，
 * 因此「同配置 ⇒ 同 key ⇒ 命中同一份缓存」。
 */
export function resolveMarkerIconDescriptor(input: string | MarkerIconInputLike): IconDescriptor {
  if (typeof input === "string") {
    const name = isBuiltinMarkerIconName(input) ? input : FALLBACK_BUILTIN_ICON_NAME;
    const override = BUILTIN_MARKER_ICON_URL_OVERRIDES[name];
    if (override) {
      return {
        imageUrl: override.imageUrl,
        width: override.width,
        height: override.height,
        anchorX: override.width / 2,
        anchorY: override.height / 2,
      };
    }
    return spriteDescriptor(name);
  }
  // 自定义描述复用 `iconCache` 的归一化实现（**不**另写一份）：内置名与自定义描述的 descriptor
  // 必须落在同一个形状上，否则同一个字段在两处会得到不同的默认值，缓存键也就不可比了。
  return normalizeIconDescriptor(input);
}
