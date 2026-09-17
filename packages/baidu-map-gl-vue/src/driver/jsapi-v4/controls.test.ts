/**
 * v4 ControlDriver（M3A2-CONTROLS-LAYERS / issue #22）
 *
 * 验收点（对应 issue #22 的「测试要求」与「验收标准」）：
 * - issue 目标与范围列出的每个控件都有 create / add / remove / show / hide 测试；
 * - anchor / offset 归一化：官方常量名 → 4.0 数值、Pixel → `Size`；非四角落点与未知常量
 *   都要**可见**（告警一次），不静默；
 * - `setOptions` 的动态 / 构造期分类：动态项走字段级 setter 或成对动作，构造期项告警且不动；
 * - Target：Map 目标原子加/摘（重复 add 不重复挂载、remove 后可重挂），非 Map 目标显式失败；
 * - 本引擎没有运行时入口的成员（`PanoramaControl` 缺基类成员、缺构造器）显式告警 / 失败。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { HANDLE_BRAND, type ControlHandle } from "../types/handles";
import { createJsapiV4ControlDriver } from "./controls";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4HandleRegistry } from "./registry";
import type { ControlKind } from "../types/controls";

/** issue #22「目标与范围」列出的十个内置控件 + 自定义控件（kind → 官方构造器名）。 */
const CONTROL_KINDS = [
  ["zoom", "ZoomControl"],
  ["scale", "ScaleControl"],
  ["navigation", "NavigationControl"],
  ["navigation-3d", "NavigationControl3D"],
  ["city-list", "CityListControl"],
  ["location", "GeolocationControl"],
  ["map-type", "MapTypeControl"],
  ["overview", "OverviewMapControl"],
  ["panorama", "PanoramaControl"],
  ["copyright", "CopyrightControl"],
] as const;

function setup(rawSdk?: unknown) {
  const fake: FakeBMapV4 = createFakeBMapV4();
  const registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const controls = createJsapiV4ControlDriver({
    rawSdk: rawSdk ?? fake.namespace,
    geometry,
    registry,
  });
  const container = document.createElement("div");
  container.style.width = "400px";
  container.style.height = "300px";
  document.body.appendChild(container);
  const rawMap = new fake.namespace.Map(container);
  const map = registry.adopt("map", rawMap);

  const rawOf = (handle: ControlHandle) => handle.raw as Record<string, unknown>;
  const mapTarget = () => ({ kind: "map" as const, handle: map });

  return { fake, registry, geometry, controls, container, rawMap, map, rawOf, mapTarget };
}

let ctx: ReturnType<typeof setup>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ctx = setup();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */
/* 1. create：十个内置控件的构造器映射与选项归一化                                */
/* -------------------------------------------------------------------------- */

describe("内置控件的创建与构造参数映射", () => {
  it.each(CONTROL_KINDS)("%s → BMap.%s", (kind, ctorName) => {
    const handle = ctx.controls.create(kind);
    const raw = ctx.rawOf(handle);

    expect(handle.raw).toBeInstanceOf(
      (ctx.fake.namespace as unknown as Record<string, unknown>)[ctorName],
    );
    expect(raw).toBeTruthy();
  });

  it("anchor 常量名换算为 4.0 数值，offset 换算为 Size", () => {
    const handle = ctx.controls.create("zoom", {
      anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
      offset: { x: 83, y: 18 },
    });
    const raw = ctx.rawOf(handle);

    // 官方四角常量：TOP_LEFT 0 / TOP_RIGHT 1 / BOTTOM_LEFT 2 / BOTTOM_RIGHT 3
    expect(raw.anchor).toBe(3);
    expect(raw.options.offset).toBeInstanceOf(ctx.fake.namespace.Size);
    expect(raw.options.offset).toMatchObject({ width: 83, height: 18 });
  });

  it("非四角落点：换算成数值但告警一次（4.0 只支持四角，SDK 会静默回落）", () => {
    const handle = ctx.controls.create("scale", { anchor: "BMAP_ANCHOR_TOP_CENTER" });
    expect(ctx.rawOf(handle).anchor).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("不是四角落点");
  });

  it("不认识的位置常量：告警一次且不透传（控件沿用自身默认落点）", () => {
    const handle = ctx.controls.create("zoom", { anchor: "BMAP_ANCHOR_TOP" });
    expect(ctx.rawOf(handle).anchor).toBeNull();
    expect(ctx.rawOf(handle).options.anchor).toBeUndefined();
    expect(String(warn.mock.calls[0][0])).toContain("不认识的停靠位置");
  });

  it("未知选项原样透传（项目 option 接口的索引签名就是 4.0 自身构造选项的逃生口）", () => {
    const handle = ctx.controls.create("city-list", { expand: true, canCheckSize: false });
    expect(ctx.rawOf(handle).options).toMatchObject({ expand: true, canCheckSize: false });
  });

  it("create('custom') 显式失败并指向 createCustomControl", () => {
    expect(() => ctx.controls.create("custom")).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("命名空间缺该构造器时显式失败，不静默返回空控件", () => {
    const namespace = { ...ctx.fake.namespace } as Record<string, unknown>;
    delete namespace.MapTypeControl;
    const isolated = setup(namespace);
    expect(() => isolated.controls.create("map-type")).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 2. 自定义控件                                                                 */
/* -------------------------------------------------------------------------- */

describe("自定义控件（BControl 的 Driver 侧）", () => {
  it("defaultAnchor / defaultOffset 用 4.0 取值，initialize 拿到地图容器", () => {
    const rendered: HTMLElement[] = [];
    const handle = ctx.controls.createCustomControl({
      anchor: "BMAP_ANCHOR_TOP_LEFT",
      offset: { x: 10, y: 20 },
      render: (mapContainer) => {
        rendered.push(mapContainer);
        return mapContainer.appendChild(document.createElement("button"));
      },
    });
    const raw = ctx.rawOf(handle);

    expect(raw).toBeInstanceOf(ctx.fake.namespace.Control);
    expect(raw.defaultAnchor).toBe(0);
    expect(raw.defaultOffset).toMatchObject({ width: 10, height: 20 });

    ctx.controls.add(ctx.mapTarget(), handle);
    // 官方在 addControl 内部调用 initialize(map) 取 DOM
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe(ctx.container);
    expect(ctx.rawMap.controls).toHaveLength(1);
  });

  it("render 返回 null 时回落到地图容器本身（官方 getContainer() 语义）", () => {
    const handle = ctx.controls.createCustomControl({ render: () => null });
    const initialize = ctx.rawOf(handle).initialize as (map: unknown) => HTMLElement;
    expect(initialize(ctx.rawMap)).toBe(ctx.container);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. add / remove / show / hide                                                */
/* -------------------------------------------------------------------------- */

describe("控件挂载、显隐与 Target 所有权", () => {
  it("add → remove 精确记账；重复 add 只挂一次；remove 后可重挂", () => {
    const target = ctx.mapTarget();
    const control = ctx.controls.create("zoom");

    ctx.controls.add(target, control);
    ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(1);

    ctx.controls.remove(target, control);
    expect(ctx.rawMap.controls).toHaveLength(0);
    expect(ctx.rawOf(control).attachedMap).toBeNull();

    ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(1);
  });

  it("show / hide 落到控件实例", () => {
    const control = ctx.controls.create("zoom");
    ctx.controls.hide(control);
    expect(ctx.rawOf(control).visible).toBe(false);
    ctx.controls.show(control);
    expect(ctx.rawOf(control).visible).toBe(true);
  });

  it("控件缺基类成员时告警一次，不抛错也不静默（PanoramaControl 由全景模块提供）", () => {
    const control = ctx.controls.create("panorama");
    // 官方：PanoramaControl 由全景模块提供、不保证 Control 基类成员。成员在原型上，
    // 因此必须用自有属性**遮蔽**原型方法才能模拟「当前实例没有 show()」。
    Object.defineProperty(ctx.rawOf(control), "show", { value: undefined, configurable: true });

    expect(() => ctx.controls.show(control)).not.toThrow();
    expect(String(warn.mock.calls[0][0])).toContain("没有 show()");
  });

  it("非 Map 目标显式失败，且不产生半挂载", () => {
    const control = ctx.controls.create("zoom");
    expect(() => ctx.controls.add({ kind: "overlay", handle: control }, control)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(ctx.rawMap.controls).toHaveLength(0);
  });

  it("拒绝跨 Client 的句柄（BMAP_HANDLE_FOREIGN）", () => {
    const other = setup();
    const foreign = other.controls.create("zoom");
    expect(() => ctx.controls.add(ctx.mapTarget(), foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 4. options 更新：动态项 vs 构造期项                                          */
/* -------------------------------------------------------------------------- */

describe("setOptions 的动态 / 构造期分类", () => {
  it("anchor / offset 是公共动态项", () => {
    const control = ctx.controls.create("zoom");
    ctx.controls.setOptions(control, {
      anchor: "BMAP_ANCHOR_TOP_LEFT",
      offset: { x: 1, y: 2 },
    });
    const raw = ctx.rawOf(control);
    expect(raw.anchor).toBe(0);
    expect(raw.offset).toMatchObject({ width: 1, height: 2 });
  });

  it("kind 专属动态项：scale.unit / navigation.type / overview.size", () => {
    const scale = ctx.controls.create("scale");
    ctx.controls.setOptions(scale, { unit: "BMAP_UNIT_IMPERIAL" });
    expect(ctx.rawOf(scale).unit).toBe("BMAP_UNIT_IMPERIAL");

    // navigation 的 setType 要求控件先挂载（真实 4.0 实测：内部滑块 DOM 在 initialize 时才建）
    const navigation = ctx.controls.create("navigation");
    ctx.controls.add(ctx.mapTarget(), navigation);
    ctx.controls.setOptions(navigation, { type: "BMAP_NAVIGATION_CONTROL_SMALL" });
    expect(ctx.rawOf(navigation).type).toBe("BMAP_NAVIGATION_CONTROL_SMALL");

    const overview = ctx.controls.create("overview");
    ctx.controls.setOptions(overview, { size: { x: 150, y: 150 } });
    expect(ctx.rawOf(overview).size).toMatchObject({ width: 150, height: 150 });
  });

  it("kind 专属 setter 在未挂载时抛错：Surface 成 BMapError 而不是被静默吞掉", () => {
    const navigation = ctx.controls.create("navigation");
    expect(() => ctx.controls.setOptions(navigation, { type: 1 })).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });

  it("成对动作型动态项：city-list.expand → open / close", () => {
    const control = ctx.controls.create("city-list");
    ctx.controls.setOptions(control, { expand: true });
    expect(ctx.rawOf(control).expanded).toBe(true);
    ctx.controls.setOptions(control, { expand: false });
    expect(ctx.rawOf(control).expanded).toBe(false);
    expect(ctx.rawOf(control).callLog).toEqual(["open", "close"]);
  });

  it("构造期项：map-type 的 type / mapTypes、overview.isOpen、city-list 的回调", () => {
    const mapType = ctx.controls.create("map-type");
    ctx.controls.setOptions(mapType, { type: "BMAP_MAPTYPE_CONTROL_DROPDOWN" });
    expect(ctx.rawOf(mapType).callLog).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain("只有构造期生效");

    const overview = ctx.controls.create("overview");
    ctx.controls.setOptions(overview, { isOpen: true });
    expect(ctx.rawOf(overview).callLog).toEqual([]);

    const cityList = ctx.controls.create("city-list");
    ctx.controls.setOptions(cityList, { trigger: document.createElement("button") });
    expect(ctx.rawOf(cityList).callLog).toEqual([]);
  });

  it("location 的 option 走「options 袋」整体写回（一次 setOptions 调用）", () => {
    const control = ctx.controls.create("location");
    ctx.controls.setOptions(control, { showAddressBar: false, watchPosition: true });
    const raw = ctx.rawOf(control);
    expect(raw.appliedBags).toEqual([{ showAddressBar: false, watchPosition: true }]);
    expect(raw.options).toMatchObject({ showAddressBar: false, watchPosition: true });
  });

  it("未知键走 set<Key> 逃生口；实例上没有该方法时按 `recreate` 告警一次（构造选项原样透传）", () => {
    const control = ctx.controls.create("zoom");
    ctx.controls.setOptions(control, { noSuchOption: 1 });
    expect(ctx.rawOf(control).callLog).toEqual([]);
    // 「没有就地入口」≠「没有入口」：Built-in 控件的构造选项是原样透传的，所以这条属于
    // 「只有构造期生效」⇒ `recreate`（#95 评审第 3 轮）。真正「连构造期也没有入口」的是
    // 自定义控件上的未知键，见下一条用例。
    expect(String(warn.mock.calls[0][0])).toContain("只有构造期生效");
    expect(ctx.controls.planOptions(control, ["noSuchOption"])).toEqual({
      noSuchOption: "recreate",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 5. 版权控件                                                                  */
/* -------------------------------------------------------------------------- */

describe("CopyrightControl 的版权增删查", () => {
  it("addCopyright / listCopyrights 往返（含 bounds）", () => {
    const control = ctx.controls.create("copyright");
    const bounds = { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } };

    ctx.controls.addCopyright(control, { id: 1, content: "<b>版权所有</b>" });
    ctx.controls.addCopyright(control, { id: 2, content: "自定义", bounds });

    expect(ctx.controls.listCopyrights(control)).toEqual([
      { id: 1, content: "<b>版权所有</b>" },
      { id: 2, content: "自定义", bounds },
    ]);
  });

  it("同 id 重复添加按官方语义覆盖", () => {
    const control = ctx.controls.create("copyright");
    ctx.controls.addCopyright(control, { id: 7, content: "旧" });
    ctx.controls.addCopyright(control, { id: 7, content: "新" });
    expect(ctx.controls.listCopyrights(control)).toEqual([{ id: 7, content: "新" }]);
  });

  it("removeCopyright 按 id 移除", () => {
    const control = ctx.controls.create("copyright");
    ctx.controls.addCopyright(control, { id: 1, content: "a" });
    ctx.controls.removeCopyright(control, 1);
    expect(ctx.controls.listCopyrights(control)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. 释放顺序（跨 Facet 不变式）                                                */
/* -------------------------------------------------------------------------- */

describe("控件释放顺序", () => {
  it("先摘控件再销毁地图：destroyedWithControls 为 0", () => {
    const target = ctx.mapTarget();
    const controls = CONTROL_KINDS.map(([kind]) => ctx.controls.create(kind));
    for (const control of controls) ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(controls.length);

    for (const control of controls) ctx.controls.remove(target, control);
    ctx.rawMap.destroy();

    expect(ctx.rawMap.destroyedWithControls).toBe(0);
  });

  it("遗漏摘除时该不变式会失败（证明这条检查不是空转）", () => {
    ctx.controls.add(ctx.mapTarget(), ctx.controls.create("zoom"));
    ctx.rawMap.destroy();
    expect(ctx.rawMap.destroyedWithControls).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. 句柄品牌（setOptions 分类的依据）                                          */
/* -------------------------------------------------------------------------- */

describe("控件句柄品牌", () => {
  it("每个 kind 的句柄都带 control:<kind> 品牌，便于按种类给出更新口径", () => {
    for (const [kind] of CONTROL_KINDS) {
      const handle = ctx.controls.create(kind);
      expect(handle[HANDLE_BRAND]).toBe(`control:${kind}`);
    }
    const custom = ctx.controls.createCustomControl({ render: () => null });
    expect(custom[HANDLE_BRAND]).toBe("control:custom");
  });
});

/* -------------------------------------------------------------------------- */
/* 8. 外部评审 P2：定位跟踪清理 / 挂载失败回滚                                   */
/* -------------------------------------------------------------------------- */

describe("[P2] 移除 location 控件要先停止持续定位跟踪", () => {
  it("stopLocationTrace 发生在 removeControl 之前", () => {
    const target = ctx.mapTarget();
    const control = ctx.controls.create("location");
    ctx.controls.add(target, control);

    // 跨对象顺序：控件自己的 callLog 与 Map 的 callLog 是两本书，必须在同一条时间线上记录
    const sequence: string[] = [];
    const raw = ctx.rawOf(control);
    const stopTrace = raw.stopLocationTrace as () => void;
    raw.stopLocationTrace = () => {
      sequence.push("stopLocationTrace");
      stopTrace.call(raw);
    };
    const rawMap = ctx.rawMap as unknown as Record<string, unknown>;
    const removeControl = rawMap.removeControl as (control: unknown) => void;
    rawMap.removeControl = (control: unknown) => {
      sequence.push("removeControl");
      removeControl.call(rawMap, control);
    };

    ctx.controls.remove(target, control);

    // 官方 Skill：控件自身的 remove() 不会停止 watchPosition，只有 stopLocationTrace 会清除它
    expect(sequence).toEqual(["stopLocationTrace", "removeControl"]);
    expect(ctx.rawMap.controls).toHaveLength(0);
  });

  it("重复移除安全：停止跟踪是无条件调用（幂等 no-op），不因记账状态跳过", () => {
    const target = ctx.mapTarget();
    const control = ctx.controls.create("location");
    ctx.controls.add(target, control);

    ctx.controls.remove(target, control);
    expect(() => ctx.controls.remove(target, control)).not.toThrow();

    const log = ctx.rawOf(control).callLog as string[];
    expect(log.filter((call) => call === "stopLocationTrace")).toHaveLength(2);
  });

  it("其他 kind 不受影响（不会误调定位清理）", () => {
    const target = ctx.mapTarget();
    const control = ctx.controls.create("zoom");
    ctx.controls.add(target, control);
    ctx.controls.remove(target, control);

    const log = ctx.rawOf(control).callLog as string[];
    expect(log.filter((call) => call.startsWith("stop"))).toEqual([]);
  });
});

describe("[P2] 挂载失败后记账必须回滚，否则重试会被静默跳过", () => {
  it("自定义控件首次挂载失败（render 抛错）→ 第二次 add 能成功", () => {
    const target = ctx.mapTarget();
    let boom = true;
    const control = ctx.controls.createCustomControl({
      render: () => {
        if (boom) throw new Error("render 首次失败");
        return document.createElement("button");
      },
    });

    expect(() => ctx.controls.add(target, control)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(ctx.rawMap.controls).toHaveLength(0);

    boom = false;
    ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(1);
  });

  it("SDK 直接拒绝 addControl（故障注入）→ 同上，第二次 add 能成功", () => {
    const target = ctx.mapTarget();
    const control = ctx.controls.create("zoom");
    ctx.rawMap.failNextAddControl = new Error("SDK 拒绝挂载");

    expect(() => ctx.controls.add(target, control)).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    expect(ctx.rawMap.controls).toHaveLength(0);

    ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(1);
  });

  it("挂载失败之后 remove 仍然到达 SDK（清理入口不依赖记账）", () => {
    const target = ctx.mapTarget();
    const control = ctx.controls.create("zoom");
    ctx.rawMap.failNextAddControl = new Error("boom");

    expect(() => ctx.controls.add(target, control)).toThrowError();
    expect(() => ctx.controls.remove(target, control)).not.toThrow();
    expect(ctx.rawMap.callLog.filter((call) => call === "removeControl")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. planOptions：构造之后的更新口径（M7-CONTROL-PANORAMA / issue #41）        */
/* -------------------------------------------------------------------------- */

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * kind → 官方构造选项声明文件（+ 接口名）。
 *
 * 读**依赖里的声明文件**而不是文档：`CityListControlOptions.d.ts` 里同时有
 * `CityListControlChangeResult`，因此必须按接口名切出正文，否则会把「结果对象」的字段
 * 当成构造选项（那会让下面的完整性断言在错误的输入上恒真）。
 */
const OFFICIAL_OPTION_SOURCES: ReadonlyArray<readonly [ControlKind, string, string]> = [
  ["zoom", "ZoomControlOptions.d.ts", "ZoomControlOptions"],
  ["scale", "ScaleControlOptions.d.ts", "ScaleControlOptions"],
  ["navigation", "NavigationControlOptions.d.ts", "NavigationControlOptions"],
  ["navigation-3d", "NavigationControl3DOptions.d.ts", "NavigationControl3DOptions"],
  ["city-list", "CityListControlOptions.d.ts", "CityListControlOptions"],
  ["location", "GeolocationControlOptions.d.ts", "GeolocationControlOptions"],
  ["map-type", "MapTypeControlOptions.d.ts", "MapTypeControlOptions"],
  ["overview", "OverviewMapControlOptions.d.ts", "OverviewMapControlOptions"],
  ["panorama", "PanoramaControlOptions.d.ts", "PanoramaControlOptions"],
  ["copyright", "CopyrightControlOptions.d.ts", "CopyrightControlOptions"],
];

function upstreamOptionKeys(fileName: string, interfaceName: string): string[] {
  const source = readFileSync(
    join(PACKAGE_ROOT, "node_modules/@baidumap/jsapi-v4-types/control", fileName),
    "utf8",
  );
  const start = source.indexOf(`interface ${interfaceName} {`);
  expect(start, `${fileName} 里找不到 interface ${interfaceName}`).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\n  }", start));
  return [...body.matchAll(/^\s{4}(\w+)\??:/gm)].map((match) => match[1]!);
}

describe("planOptions：三档口径与官方声明的完整性", () => {
  it.each(OFFICIAL_OPTION_SOURCES)(
    "%s 的官方构造选项都有落地方式（没有 unsupported）",
    (kind, fileName, interfaceName) => {
      const handle = ctx.controls.create(kind);
      const keys = upstreamOptionKeys(fileName, interfaceName);
      // 正证守卫：解析失败会让 keys 为空，那样「没有 unsupported」就是恒真的空转
      expect(keys).toContain("anchor");
      expect(keys).toContain("offset");

      const plan = ctx.controls.planOptions(handle, keys);
      const unsupported = keys.filter((key) => plan[key] === "unsupported");
      expect(unsupported, `${kind} 的这些官方选项没有入口`).toEqual([]);
    },
  );

  /**
   * 组件侧的反向核对：**对外声明的选项 prop 都必须有落地方式**。
   *
   * 这就是 `map-type.showStreetLayer` 修复前的形状——它在官方实例上存在（`showStreetLayer(isShow)`），
   * 但成员名不是 `set<Key>`，于是被结构逃生口判成「没有入口」、值被静默丢弃。只测「没抛错」
   * 是发现不了的。
   *
   * 组件 → kind 的**选项 prop 名单不是手写的**，而是从 SFC 的 props 接口解析出来的：手写清单
   * 有两个致命弱点——① 组件将来新增一个 prop 时清单不会变红（门禁随即失效）；② 空清单会走
   * 空循环「通过」（恒真的空转）。因此断言前先要求解析出的 prop 里包含 `anchor`。
   */
  const CONTROL_COMPONENTS: ReadonlyArray<readonly [string, string, ControlKind]> = [
    ["controls", "BZoom.vue", "zoom"],
    ["controls", "BScale.vue", "scale"],
    ["controls", "BNavigation.vue", "navigation"],
    ["controls", "BNavigation3d.vue", "navigation-3d"],
    ["controls", "BCityList.vue", "city-list"],
    ["controls", "BLocation.vue", "location"],
    ["controls", "BMapType.vue", "map-type"],
    ["controls", "BOverview.vue", "overview"],
    ["controls", "BPanoramaControl.vue", "panorama"],
    ["controls", "BCopyright.vue", "copyright"],
    ["controls", "BControl.vue", "custom"],
  ];

  /** 全部控件共有的 props（`anchor` / `offset` / `visible`），不算「控件专属选项」。 */
  const COMMON_CONTROL_PROPS = new Set(["anchor", "offset", "visible"]);

  /** 从 SFC 源码里解析 `export interface <Name>Props { … }` 的成员名。 */
  function componentPropNames(directory: string, fileName: string): string[] {
    const source = readFileSync(
      join(PACKAGE_ROOT, `src/components/${directory}/${fileName}`),
      "utf8",
    );
    const start = source.indexOf("export interface ");
    expect(start, `${fileName} 里找不到 props 接口`).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n}", start));
    return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]!);
  }

  it.each(CONTROL_COMPONENTS)("%s/%s 的选项 prop 都有落地方式", (directory, fileName, kind) => {
    const all = componentPropNames(directory, fileName);
    // 正证守卫：解析失败（或接口改名）时必须在这里红，而不是让下面的循环空转
    expect(all, `${fileName} 的 props 解析结果里没有 anchor`).toContain("anchor");
    const keys = all.filter((key) => !COMMON_CONTROL_PROPS.has(key));
    // `custom` 走 `createCustomControl`（Driver 对 `create("custom")` 显式失败，见其注释）
    const handle =
      kind === "custom"
        ? ctx.controls.createCustomControl({ render: () => document.createElement("div") })
        : ctx.controls.create(kind);
    const plan = ctx.controls.planOptions(handle, keys);
    for (const key of keys) expect(plan[key], `${kind}.${key}`).not.toBe("unsupported");
  });

  it("解析出的组件选项 prop 清单确实覆盖了三个新组件的可更新 / 构造期项（防空转）", () => {
    // 这条是上一条的**正证**：如果 `componentPropNames` 哪天退化成只读 `anchor`，
    // 上一条会静默通过——所以这里点名校验几个已知的选项 prop。
    expect(componentPropNames("controls", "BMapType.vue")).toEqual(
      expect.arrayContaining(["type", "mapTypes", "showStreetLayer"]),
    );
    expect(componentPropNames("controls", "BOverview.vue")).toEqual(
      expect.arrayContaining(["size", "isOpen", "zoomInterval", "padding"]),
    );
    expect(componentPropNames("controls", "BNavigation.vue")).toEqual(
      expect.arrayContaining(["type", "showZoomInfo", "enableGeolocation"]),
    );
    // 全景组件的选项（`displayDistance` 只有构造期生效）也在解析范围内
    expect(componentPropNames("panorama", "BPanoramaLabel.vue")).toEqual(
      expect.arrayContaining(["content", "position", "altitude", "displayDistance"]),
    );
  });

  it("逐键分类与 setOptions 的实际效果一一对应（同源）", () => {
    const handle = ctx.controls.create("map-type");
    ctx.controls.add(ctx.mapTarget(), handle);
    const raw = ctx.rawOf(handle) as unknown as { callLog: string[] };

    // live：真的写到实例上
    expect(ctx.controls.planOptions(handle, ["showStreetLayer"]).showStreetLayer).toBe("mutable");
    ctx.controls.setOptions(handle, { showStreetLayer: false });
    expect(raw.callLog).toContain("showStreetLayer:off");

    // recreate：告警一次且**不动实例**
    expect(ctx.controls.planOptions(handle, ["type"]).type).toBe("recreate");
    warn.mockClear();
    const before = raw.callLog.length;
    ctx.controls.setOptions(handle, { type: "BMAP_MAPTYPE_CONTROL_DROPDOWN" });
    expect(raw.callLog.length).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);

    // 未命中分类表的键 ⇒ `recreate`（构造选项原样透传，构造期仍可能生效），不是 unsupported
    expect(ctx.controls.planOptions(handle, ["nope"]).nope).toBe("recreate");
    warn.mockClear();
    ctx.controls.setOptions(handle, { nope: 1 });
    expect(raw.callLog.length).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("`unsupported` 只留给「连构造期也到不了」的键（自定义控件上未知的键）", () => {
    const handle = ctx.controls.createCustomControl({
      render: () => document.createElement("div"),
    });
    ctx.controls.add(ctx.mapTarget(), handle);
    const raw = ctx.rawOf(handle) as unknown as { callLog: string[] };

    expect(ctx.controls.planOptions(handle, ["nope"])).toEqual({ nope: "unsupported" });
    warn.mockClear();
    ctx.controls.setOptions(handle, { nope: 1 });
    expect(raw.callLog).not.toContain("setNope");
    expect(warn).toHaveBeenCalledTimes(1);

    // 反向：全部 kind 的 anchor / offset 仍然是 live（自定义控件走 setAnchor / setOffset）
    expect(ctx.controls.planOptions(handle, ["anchor", "offset"])).toEqual({
      anchor: "mutable",
      offset: "mutable",
    });
  });

  it("anchor 在除版权控件外的 kind 上都是 live，且 anchor 变化会把 offset 一并写下去", () => {
    const handle = ctx.controls.create("overview", { offset: { x: 700, y: 800 } });
    ctx.controls.add(ctx.mapTarget(), handle);
    const raw = ctx.rawOf(handle) as unknown as {
      callLog: string[];
      getOffset(): { width: number; height: number } | null;
    };

    expect(ctx.controls.planOptions(handle, ["anchor", "offset"])).toEqual({
      anchor: "mutable",
      offset: "mutable",
    });

    ctx.controls.setOptions(handle, { anchor: "BMAP_ANCHOR_TOP_LEFT", offset: { x: 700, y: 800 } });
    expect(raw.callLog).toContain("setAnchor");
    expect(raw.getOffset()).toEqual({ width: 700, height: 800 });
  });

  it("版权控件的 anchor 是构造期项（实例按停靠位置共享，就地 setAnchor 会让它脱钩）", () => {
    const handle = ctx.controls.create("copyright", { anchor: "BMAP_ANCHOR_TOP_LEFT" });
    ctx.controls.add(ctx.mapTarget(), handle);
    const raw = ctx.rawOf(handle) as unknown as { callLog: string[] };

    expect(ctx.controls.planOptions(handle, ["anchor", "offset"])).toEqual({
      anchor: "recreate",
      offset: "mutable",
    });

    // `recreate` 的口径：告警一次且**不动实例**（把重建的决定交给调用方）
    warn.mockClear();
    ctx.controls.setOptions(handle, { anchor: "BMAP_ANCHOR_BOTTOM_RIGHT" });
    expect(raw.callLog).not.toContain("setAnchor");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/* 与官方声明的对齐（正 / 反两个方向，含空转守卫） */
describe("planOptions 的空转守卫", () => {
  it("解析上游声明失败时必须报错，而不是得到空列表", () => {
    expect(() => upstreamOptionKeys("ZoomControlOptions.d.ts", "不存在的接口")).toThrowError();
  });

  it("upstreamOptionKeys 对已知接口至少能读出 anchor / offset", () => {
    expect(upstreamOptionKeys("ZoomControlOptions.d.ts", "ZoomControlOptions")).toEqual([
      "anchor",
      "offset",
    ]);
  });
});
