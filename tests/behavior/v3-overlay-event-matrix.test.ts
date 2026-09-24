/**
 * 覆盖物事件矩阵门禁（M5-VECTORS / issue #31，多文件解析由 M5-CUSTOM-MENU / issue #33 扩展）
 *
 * 事件名与载荷形状是**公共契约**：组件的 `defineEmits`、Driver 的归一化兜底、文档表格三者必须
 * 来自同一份数据。本文件把「同一份数据」变成可执行断言，六类：
 *
 * 1. **上游权威清单**：解析 `@baidumap/jsapi-v4-types@4.0.4` 的三份 `.d.ts`
 *    （`overlay/OverlayEvent.d.ts` + `overlay/CustomOverlay.d.ts` + `context-menu/ContextMenu.d.ts`；
 *    #33 之前只读第一份，于是 CustomOverlay / ContextMenu 被误登记成「上游没有事件表」），
 *    把每个 `*EventMap`（含 `type X = GraphEventMap<T>` 与 `Omit<GraphEventMap<T>, …>` 两种形态）
 *    解析成事件名集合，与矩阵**双向取差集**（多一个 / 少一个都红）。上游类型包只在这里被当
 *    **文本**读——公共类型自持，`check:public-dts` 不允许发布声明引用它。
 * 2. **每张上游表只出现一次**：同名 `*EventMap` 出现在两个文件里本身就说明读法要更新，
 *    不能靠「合并成一张全局表」把它掩盖过去（那正是 #33 修掉的那个假结论的成因）。
 * 3. **Vue 命名规范**：`vue === toVueEventName(sdk)`（与 map 事件共用同一条推导），且同一 kind 内
 *    归一化后不撞车。
 * 4. **载荷档 ↔ Driver 兜底**：矩阵的 `pointer` / `partial-pointer` 必须与
 *    `overlayPointerFallback()` 的判断逐条一致，并用**真实归一化函数**喂空 raw 做 fixture；
 *    同时证明这条覆盖物规则**没有**改变 map / layer 的既有口径。
 * 5. **端到端**：走默认路径装出的 v4 Client，在真实 `EventDriver` 上订阅并派发，观察
 *    `point` 到底有没有被兜底——判据落在「调用方实际收到什么」上，而不是函数返回值。
 * 6. **编辑能力边界**：矩阵里有 `requiresEditing` 事件的 kind，描述符必须真的能开编辑；
 *    上游 Omit 掉编辑事件的 kind（Prism / BezierCurve）一个编辑事件都不许有。
 */
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  OVERLAY_EVENT_MATRIX,
  OVERLAY_KINDS_WITHOUT_EVENT_MATRIX,
  overlayEventOf,
  overlayEventsOf,
  overlayPointerFallback,
} from "../../packages/bmap-vue/src/core/overlays/overlayEventCatalog";
import { toVueEventName } from "../../packages/bmap-vue/src/core/events/eventCatalog";
import {
  normalizeDriverEvent,
  POINTER_EVENT_NAMES,
} from "../../packages/bmap-vue/src/driver/normalize/events";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import {
  OVERLAY_DESCRIPTORS,
  overlayPropertySpec,
} from "../../packages/bmap-vue/src/driver/types/overlays";
import type { OverlayKind } from "../../packages/bmap-vue/src/driver/types/overlays";
import { createFakeBMapV4 } from "../../packages/test-utils/fake-bmap-v4";
import { createFakeV4Client } from "../../packages/test-utils/fake-v4-harness";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

/** 定位上游类型包（与 `v3-map-event-catalog.test.ts` 同一套候选路径）。 */
function resolveUpstreamPackageDir(): string {
  const candidates = [
    resolve(REPO_ROOT, "packages/bmap-vue/node_modules/@baidumap/jsapi-v4-types"),
    resolve(REPO_ROOT, "node_modules/@baidumap/jsapi-v4-types"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
  }
  throw new Error(`未找到已安装的 @baidumap/jsapi-v4-types；候选路径：${candidates.join(", ")}`);
}

interface UpstreamEventMap {
  /** 事件名。 */
  readonly names: string[];
  /** 该声明派生自哪张基础表（`Omit` 形态用）。 */
  readonly base?: string;
  /** 该声明的**声明所在文件**（相对类型包根）：同名表出现在两处时能被抓到。 */
  readonly file: string;
}

/**
 * 上游声明事件表的文件清单（#33）。
 *
 * 必须显式列出而不是 `readdir` 全包：上游把每一类的事件表放在**它自己那一类**的声明里，
 * 「只读一个文件」正是 #33 之前把 `custom-overlay` / `context-menu` 误判成「没有事件表」的原因。
 * 少列一个文件 ⇒ 对应的表解析不到 ⇒ `expectedUpstreamMapName` 的断言直接红（fail-closed）。
 */
const UPSTREAM_EVENT_FILES = [
  "overlay/OverlayEvent.d.ts",
  "overlay/CustomOverlay.d.ts",
  "context-menu/ContextMenu.d.ts",
] as const;

/**
 * 解析上游全部事件表（三份 `.d.ts` 合并成 `表名 → { names, file }`）。
 *
 * 三种形态都要认（上游就是这么写的）：
 * - `interface MarkerEventMap { … }`（成员即事件名）；
 * - `type PolylineEventMap = GraphEventMap<Polyline>;`（派生自基础表）；
 * - `type PrismEventMap = Omit<GraphEventMap<Prism>, 'editstart' | …>;`（基础表减去若干）。
 *
 * 同名表出现在多个文件时**保留首个并在 `duplicates` 里登记**，由用例判红——不做「后写覆盖」，
 * 那会把「上游挪了声明位置」静默吃掉。
 */
function parseUpstreamEventMaps(): {
  maps: Map<string, UpstreamEventMap>;
  duplicates: string[];
  scannedFiles: string[];
} {
  const root = resolveUpstreamPackageDir();
  const maps = new Map<string, UpstreamEventMap>();
  const duplicates: string[] = [];
  const scannedFiles: string[] = [];

  for (const relative of UPSTREAM_EVENT_FILES) {
    const file = join(root, relative);
    if (!existsSync(file)) {
      throw new Error(`上游类型包里没有 ${relative}（事件表可能被挪走了）`);
    }
    scannedFiles.push(relative);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const here = new Map<string, UpstreamEventMap>();
    const typeAliases = new Map<string, ts.TypeNode>();

    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith("EventMap")) {
        const names: string[] = [];
        for (const member of node.members) {
          const name = member.name;
          if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) names.push(name.text);
        }
        here.set(node.name.text, { names, file: relative });
      }
      if (ts.isTypeAliasDeclaration(node) && node.name.text.endsWith("EventMap")) {
        typeAliases.set(node.name.text, node.type);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);

    for (const [name, type] of typeAliases) {
      const described = describeAlias(type, here);
      if (described) here.set(name, { ...described, file: relative });
    }

    for (const [name, entry] of here) {
      if (maps.has(name)) duplicates.push(name);
      else maps.set(name, entry);
    }
  }
  return { maps, duplicates, scannedFiles };
}

/** 把 `GraphEventMap<T>` / `Omit<GraphEventMap<T>, 'a' | 'b'>` 解析成事件名集合。 */
function describeAlias(
  type: ts.TypeNode,
  interfaces: Map<string, UpstreamEventMap>,
): { names: string[]; base?: string } | undefined {
  // Omit<Base, 'a' | 'b'>
  if (ts.isTypeReferenceNode(type) && (type.typeName as ts.Identifier).text === "Omit") {
    const [baseRef, keysNode] = type.typeArguments ?? [];
    if (!baseRef || !keysNode || !ts.isTypeReferenceNode(baseRef)) return undefined;
    const base = interfaces.get((baseRef.typeName as ts.Identifier).text);
    if (!base) return undefined;
    const omitted = new Set<string>();
    if (ts.isUnionTypeNode(keysNode)) {
      for (const member of keysNode.types) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
          omitted.add(member.literal.text);
        }
      }
    }
    return { names: base.names.filter((name) => !omitted.has(name)), base: "Omit" };
  }
  // Base<T>
  if (ts.isTypeReferenceNode(type)) {
    const base = interfaces.get((type.typeName as ts.Identifier).text);
    return base ? { names: [...base.names] } : undefined;
  }
  return undefined;
}

const parsed = parseUpstreamEventMaps();
const upstream = parsed.maps;

/** 每个 kind 对应的上游事件表名。 */
const UPSTREAM_MAP_BY_KIND: Readonly<Partial<Record<OverlayKind, string>>> = {
  marker: "MarkerEventMap",
  label: "LabelEventMap",
  polyline: "PolylineEventMap",
  polygon: "PolygonEventMap",
  rectangle: "RectangleEventMap",
  circle: "CircleEventMap",
  prism: "PrismEventMap",
  "bezier-curve": "BezierCurveEventMap",
  "ground-overlay": "GroundOverlayEventMap",
  "info-window": "InfoWindowEventMap",
  "custom-overlay": "CustomOverlayEventMap",
  "context-menu": "ContextMenuEventMap",
};

/**
 * 每个 kind 的事件表**声明所在文件**（从 kind 推导不出来：上游把每一类的表放在它自己的声明里，
 * 而不是统一的 `OverlayEvent.d.ts`）。
 *
 * 它是唯一一张手写映射，因此由用例**双向**守住：表里写的文件必须真的含有那张表
 * （`上游事件表与实际声明文件一致` 一条），而 `UPSTREAM_EVENT_FILES` 少列一个文件会让解析直接失败。
 */
const UPSTREAM_FILE_BY_KIND: Readonly<Partial<Record<OverlayKind, string>>> = {
  marker: "overlay/OverlayEvent.d.ts",
  label: "overlay/OverlayEvent.d.ts",
  polyline: "overlay/OverlayEvent.d.ts",
  polygon: "overlay/OverlayEvent.d.ts",
  rectangle: "overlay/OverlayEvent.d.ts",
  circle: "overlay/OverlayEvent.d.ts",
  prism: "overlay/OverlayEvent.d.ts",
  "bezier-curve": "overlay/OverlayEvent.d.ts",
  "ground-overlay": "overlay/OverlayEvent.d.ts",
  "info-window": "overlay/OverlayEvent.d.ts",
  "custom-overlay": "overlay/CustomOverlay.d.ts",
  "context-menu": "context-menu/ContextMenu.d.ts",
};

const matrixKinds = Object.keys(OVERLAY_EVENT_MATRIX) as OverlayKind[];

describe("#31 上游 OverlayEvent.d.ts 解析守卫", () => {
  it("解析结果非空且形状正确（解析方式失效时不静默得到两个空集合）", () => {
    const graph = upstream.get("GraphEventMap");
    expect(graph, "上游 GraphEventMap 解析失败").toBeDefined();
    expect(graph!.names.length).toBeGreaterThan(10);
    // Omit 形态必须真的被识别出来（不然「Prism 没有编辑事件」会变成「两边都空」的恒真断言）
    expect(upstream.get("PrismEventMap")?.base).toBe("Omit");
    expect(upstream.get("PrismEventMap")!.names).not.toContain("editstart");
    expect(upstream.get("PolylineEventMap")!.names).toContain("editstart");
  });

  it("三份上游声明文件都真的被读到（少列一个文件会让对应 kind 的表解析不到）", () => {
    expect([...parsed.scannedFiles].sort()).toEqual([...UPSTREAM_EVENT_FILES].sort());
    // 正证守卫：#33 新增的两张表**必须**来自它们各自的文件，而不是被合并进来的
    expect(upstream.get("CustomOverlayEventMap")?.file).toBe("overlay/CustomOverlay.d.ts");
    expect(upstream.get("ContextMenuEventMap")?.file).toBe("context-menu/ContextMenu.d.ts");
  });

  it("没有任何一张上游事件表同时出现在两个文件里", () => {
    expect(parsed.duplicates).toEqual([]);
  });

  it("每个 kind 的事件表名与声明文件都对得上", () => {
    for (const kind of matrixKinds) {
      const mapName = UPSTREAM_MAP_BY_KIND[kind];
      expect(mapName, `${kind} 没有登记上游事件表名`).toBeDefined();
      const entry = upstream.get(mapName!);
      expect(entry, `${kind} 的上游事件表 ${mapName} 解析失败`).toBeDefined();
      expect(entry!.file, `${kind}（${mapName}）的实际声明文件`).toBe(UPSTREAM_FILE_BY_KIND[kind]);
    }
  });
});

/**
 * 该 kind 的**期望**上游事件表名（从 kind 推导出来，而不是读那张待校验的映射表）。
 *
 * 不这么做的话，`UPSTREAM_MAP_BY_KIND` 自己就是唯一的事实源：把 `polygon` 指向
 * `PolylineEventMap`（两者在上游都是同一个 `GraphEventMap<T>`，事件集一模一样）时，
 * 双向差集与计数全都照旧通过——「矩阵对上了上游」这句话就不可证伪了。
 */
function expectedUpstreamMapName(kind: string): string {
  const pascal = kind
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}EventMap`;
}

describe("#31 事件矩阵 ↔ 上游 EventMap（双向取差集）", () => {
  it.each(matrixKinds)("%s：登记的上游事件表名与 kind 推导一致", (kind) => {
    expect(UPSTREAM_MAP_BY_KIND[kind], `${kind} 没有登记上游事件表名`).toBe(
      expectedUpstreamMapName(kind),
    );
  });

  it.each(matrixKinds)("%s：上游声明的每个事件都在矩阵里（不遗漏）", (kind) => {
    const expected = upstream.get(UPSTREAM_MAP_BY_KIND[kind]!)!.names;
    const actual = overlayEventsOf(kind).map((event) => event.sdk);
    // 正证守卫：两侧都非空时，「差集为空」才有意义（空集合对比恒真）
    expect(expected.length, `${kind} 的上游事件表解析为空`).toBeGreaterThan(0);
    expect(actual.length, `${kind} 的矩阵为空`).toBeGreaterThan(0);
    expect(expected.filter((name) => !actual.includes(name))).toEqual([]);
  });

  it.each(matrixKinds)("%s：矩阵里每个事件上游都声明了（不臆造）", (kind) => {
    const expected = upstream.get(UPSTREAM_MAP_BY_KIND[kind]!)!.names;
    const actual = overlayEventsOf(kind).map((event) => event.sdk);
    expect(expected.length, `${kind} 的上游事件表解析为空`).toBeGreaterThan(0);
    expect(actual.length, `${kind} 的矩阵为空`).toBeGreaterThan(0);
    expect(actual.filter((name) => !expected.includes(name))).toEqual([]);
  });

  it("事件数量与上游逐类相等（把「两边都空」也堵住）", () => {
    const counts = Object.fromEntries(
      matrixKinds.map((kind) => [kind, overlayEventsOf(kind).length]),
    );
    expect(counts).toEqual({
      marker: 11,
      label: 8,
      polyline: 17,
      polygon: 17,
      rectangle: 17,
      circle: 17,
      prism: 11,
      "bezier-curve": 11,
      "ground-overlay": 11,
      "info-window": 6,
      // #33 补上的两张表：CustomOverlayEventMap / ContextMenuEventMap
      "custom-overlay": 3,
      "context-menu": 2,
    });
  });

  it("没有事件矩阵的 kind 都是显式登记过的（fail-closed）", () => {
    const classified = new Set<string>([...matrixKinds, ...Object.keys(OVERLAY_KINDS_WITHOUT_EVENT_MATRIX)]);
    const kinds = Object.keys(OVERLAY_DESCRIPTORS) as OverlayKind[];
    expect(kinds.filter((kind) => !classified.has(kind))).toEqual([]);
    // 反向：登记表里不能有已经不属于覆盖物的名字
    expect(Object.keys(OVERLAY_KINDS_WITHOUT_EVENT_MATRIX).filter((kind) => !kinds.includes(kind as OverlayKind))).toEqual([]);
    for (const [kind, reason] of Object.entries(OVERLAY_KINDS_WITHOUT_EVENT_MATRIX)) {
      expect(reason.trim().length, `${kind} 的「无事件表」理由过短`).toBeGreaterThan(10);
    }
  });
});

describe("#31 Vue 命名规范", () => {
  it.each(matrixKinds)("%s：vue === toVueEventName(sdk)，且键就是 vue 名", (kind) => {
    const entry = OVERLAY_EVENT_MATRIX[kind as keyof typeof OVERLAY_EVENT_MATRIX];
    for (const [key, definition] of Object.entries(entry.events)) {
      expect(definition.vue, `${kind}.${key}`).toBe(toVueEventName(definition.sdk));
      expect(key, `${kind}.${key} 的键不是规范 Vue 名`).toBe(definition.vue);
      // 订阅名与 emit 名都可以拿它查到同一条（组件的 emit 与 Driver 的订阅共用一份数据）
      expect(overlayEventOf(kind, definition.sdk)).toBe(definition);
      expect(overlayEventOf(kind, definition.vue)).toBe(definition);
    }
  });

  it("入口对未知名字返回 undefined（raw 逃生口的判据，不静默降级）", () => {
    expect(overlayEventOf("polyline", "someFutureEvent")).toBeUndefined();
    // 事件面按 kind 收窄：Marker 的拖拽事件在 Polygon 上不存在
    expect(overlayEventOf("polygon", "dragstart")).toBeUndefined();
    expect(overlayEventOf("marker", "dragstart")).toBeDefined();
  });
});

describe("#31 载荷档 ↔ Driver 指针兜底", () => {
  const geometry = createJsapiV4GeometryDriver(createFakeBMapV4().namespace);

  it("pointer ⇒ 兜底；partial-pointer / base ⇒ 不兜底", () => {
    for (const kind of matrixKinds) {
      for (const definition of overlayEventsOf(kind)) {
        const expected = definition.payload === "pointer" ? "default" : "never";
        expect(
          overlayPointerFallback(kind, definition.sdk),
          `${kind}.${definition.sdk}（${definition.payload}）的兜底策略`,
        ).toBe(expected);
      }
    }
  });

  it("正证守卫：两类档位都真的有成员（否则上面的断言在空集合上恒真）", () => {
    const all = matrixKinds.flatMap((kind) => overlayEventsOf(kind));
    expect(all.filter((event) => event.payload === "pointer").length).toBeGreaterThan(10);
    expect(all.filter((event) => event.payload === "partial-pointer").length).toBeGreaterThan(5);
    // 具体到「哪一条是 partial」也要点名：图形族 mouseout 与 GroundOverlay 的整族
    expect(overlayEventOf("polyline", "mouseout")?.payload).toBe("partial-pointer");
    expect(overlayEventOf("marker", "mouseout")?.payload).toBe("pointer");
    expect(overlayEventOf("ground-overlay", "click")?.payload).toBe("partial-pointer");
  });

  it("真实归一化：空 raw 下 pointer 补 (0,0)、partial 保持缺失", () => {
    const filled = normalizeDriverEvent("click", {}, geometry);
    expect(filled.point).toEqual({ lng: 0, lat: 0 });
    const kept = normalizeDriverEvent("mouseout", {}, geometry, { pointerFallback: "never" });
    expect(kept.point).toBeUndefined();
    // raw 真的带坐标时两种策略都不改写
    const real = { point: { lng: 116.4, lat: 39.9 } };
    expect(normalizeDriverEvent("mouseout", real, geometry, { pointerFallback: "never" }).point).toEqual(
      { lng: 116.4, lat: 39.9 },
    );
  });

  it("这条覆盖物规则没有改变 map / layer 的既有口径", () => {
    // map 目标与未被矩阵覆盖的 kind 都返回 default
    expect(overlayPointerFallback(undefined, "mouseout")).toBe("default");
    expect(overlayPointerFallback("map-mask", "mouseout")).toBe("default");
    // 矩阵里没有的事件名也返回 default（不因为「查不到」而改变行为）
    expect(overlayPointerFallback("polyline", "someFutureEvent")).toBe("default");
    // map 事件的兜底清单本身没动
    expect(POINTER_EVENT_NAMES).toContain("mouseout");
    expect([...POINTER_EVENT_NAMES].sort()).toEqual(
      [
        "click", "dblclick", "rightclick", "rightdblclick", "mousemove", "mousedown", "mouseup",
        "mouseover", "mouseout", "touchstart", "touchmove", "touchend", "mousewheel",
        "dragstart", "dragging", "dragend",
      ].sort(),
    );
  });
});

describe("#31 端到端：真实 EventDriver 上的订阅与派发", () => {
  async function connectPolyline(kind: "polyline" | "marker" | "ground-overlay") {
    const { fake, client } = await createFakeV4Client();
    const overlays = client.driver.overlays;
    const handle =
      kind === "polyline"
        ? overlays.createPolyline([
            { lng: 116.4, lat: 39.9 },
            { lng: 116.5, lat: 40 },
          ])
        : kind === "marker"
          ? overlays.createMarker({ lng: 116.4, lat: 39.9 })
          : overlays.createGroundOverlay({
              southwest: { lng: 116.3, lat: 39.8 },
              northeast: { lng: 116.5, lat: 40 },
            });
    return { fake, client, handle, raw: handle.raw as { emit: (t: string, p?: object) => void } };
  }

  it("图形族 mouseout 缺坐标时不补 (0,0)，click 缺坐标时补", async () => {
    const { client, handle, raw } = await connectPolyline("polyline");
    const seen: Array<{ type: string; point: unknown }> = [];
    const offClick = client.driver.events.on(handle, "click", (event: any) =>
      seen.push({ type: "click", point: event.point }),
    );
    const offOut = client.driver.events.on(handle, "mouseout", (event: any) =>
      seen.push({ type: "mouseout", point: event.point }),
    );

    raw.emit("click");
    raw.emit("mouseout");
    raw.emit("mouseout", { point: { lng: 116.44, lat: 39.94 } });

    expect(seen).toEqual([
      { type: "click", point: { lng: 0, lat: 0 } },
      { type: "mouseout", point: undefined },
      { type: "mouseout", point: { lng: 116.44, lat: 39.94 } },
    ]);

    offClick();
    offOut();
    expect((handle.raw as { getListenerCount: () => number }).getListenerCount()).toBe(0);
  });

  it("Marker 的 mouseout 仍是必填口径（上游 OverlayMouseEvent 声明必填）", async () => {
    const { client, handle, raw } = await connectPolyline("marker");
    const points: unknown[] = [];
    const off = client.driver.events.on(handle, "mouseout", (event: any) => points.push(event.point));
    raw.emit("mouseout");
    expect(points).toEqual([{ lng: 0, lat: 0 }]);
    off();
  });

  it("GroundOverlay 家族的 click 不补（上游字段全部可缺）", async () => {
    const { client, handle, raw } = await connectPolyline("ground-overlay");
    const points: unknown[] = [];
    const off = client.driver.events.on(handle, "click", (event: any) => points.push(event.point));
    raw.emit("click");
    expect(points).toEqual([undefined]);
    off();
  });

  it("同一份 Driver 上两条策略并存：map 的 mouseout 照旧补 (0,0)", async () => {
    const { fake, client } = await createFakeV4Client();
    const container = document.createElement("div");
    container.style.width = "320px";
    container.style.height = "240px";
    document.body.appendChild(container);
    const map = client.driver.map.create(container);
    const raw = fake.createdMaps[fake.createdMaps.length - 1]!;
    const points: unknown[] = [];
    const off = client.driver.events.on(map, "mouseout", (event: any) => points.push(event.point));
    raw.emit("mouseout");
    expect(points).toEqual([{ lng: 0, lat: 0 }]);
    off();
    client.driver.map.destroy(map);
  });
});

describe("#31 编辑事件按能力注册", () => {
  const kindsWithEditing = matrixKinds.filter((kind) =>
    overlayEventsOf(kind).some((event) => event.requiresEditing),
  );

  it("带 requiresEditing 事件的 kind，恰好是描述符里能开编辑的那四个图形", () => {
    expect([...kindsWithEditing].sort()).toEqual(["circle", "polygon", "polyline", "rectangle"]);
  });

  it.each(kindsWithEditing)("%s：描述符里有 enableEditing 的成对开关", (kind) => {
    const spec = overlayPropertySpec(kind, "enableEditing");
    expect(spec, `${kind} 缺少 enableEditing`).toBeDefined();
    expect(spec!.policy).toBe("mutable");
    expect(spec!.toggle ?? []).toEqual(["enableEditing", "disableEditing"]);
  });

  it("上游 Omit 掉编辑事件的 kind 一个编辑事件都不许有，描述符里也没有 enableEditing", () => {
    for (const kind of ["prism", "bezier-curve"] as const) {
      expect(overlayEventsOf(kind).filter((event) => event.requiresEditing)).toEqual([]);
      expect(overlayEventOf(kind, "editstart")).toBeUndefined();
      expect(overlayPropertySpec(kind, "enableEditing"), `${kind} 不该有 enableEditing`).toBeUndefined();
    }
  });

  it("lineupdate 不属于「需要编辑」那一档（节点数据变化本身不需要编辑开关）", () => {
    expect(overlayEventOf("polyline", "lineupdate")?.requiresEditing).toBe(false);
    expect(overlayEventOf("prism", "lineupdate")).toBeDefined();
  });
});
