/**
 * Map 事件 Catalog 门禁（M4-EVENTS / issue #28）
 *
 * 事件名是公共契约：`<Map @xxx>`、`useMapEvent("xxx")` 与文档表格必须来自**同一份数据**。
 * 本文件把「同一份数据」变成可执行断言，四类：
 *
 * 1. **上游权威清单**：直接解析 `@baidumap/jsapi-v4-types@4.0.4` 的 `core/MapEvent.d.ts`，
 *    取出 `interface MapEventMap` 的成员名，与本表 `declared: true` 的 SDK 名**双向取差集**
 *    （任一方向非空即红）。上游类型包只在这里被当**文本**读——公共类型自持，
 *    `check:public-dts` 不允许发布声明引用它。
 * 2. **名字推导**：`vue === sdk.replace(/_/g, "-")` 对每条成立（含正例与「不替上游拆词」的反例），
 *    且不同条目归一化后不撞车（撞车会让 `resolveMapEventName` 命中错条目）。
 * 3. **指针标记 ↔ Driver 兜底清单**：Catalog 的 `pointer: true` 与
 *    `driver/normalize/events.ts` 导出的 `POINTER_EVENT_NAMES` 逐项相等，并用真实归一化
 *    函数喂空 raw 做 fixture（`pointer: true` ⇒ 有 `point`，否则没有）。
 * 4. **文档镜像**：`docs/zh-CN/guide/com-events.md` 的表格行与本表逐条相等（名字 + 说明），
 *    文档不再是一份手抄件。
 */
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  BMAP_COMPONENT_EVENT_CATALOG,
  MAP_EVENT_CATALOG,
  MAP_EVENT_EMIT_ALIASES,
  MAP_CONTEXT_OWNED_EVENTS,
  MAP_EVENT_NAMES,
  normalizeEventKey,
  resolveMapEventName,
  toSdkEventName,
  toVueEventName,
} from "../../packages/bmap-vue/src/core/events/eventCatalog";
import {
  normalizeDriverEvent,
  normalizeMapMouseEvent,
  POINTER_EVENT_NAMES,
} from "../../packages/bmap-vue/src/driver/normalize/events";
import { createJsapiV4GeometryDriver } from "../../packages/bmap-vue/src/driver/jsapi-v4/geometry";
import { createFakeBMapV4 } from "../../packages/test-utils/fake-bmap-v4";
import { createFakeV4Client } from "../../packages/test-utils/fake-v4-harness";
import { MAP_EVENT_READBACK_FIELDS } from "../../packages/bmap-vue/src/driver/jsapi-v4/events";
import { stripComments } from "../../packages/test-utils";

/** 带尺寸的容器（Fake 的 `getSize()` 从内联样式解析）。 */
function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DOCS_EVENTS_PAGE = resolve(REPO_ROOT, "docs/zh-CN/guide/com-events.md");
const BMAP_SFC = resolve(
  REPO_ROOT,
  "packages/bmap-vue/src/components/map/Map.vue",
);

/** 定位上游类型包（与 `upstream-types-case-patch.test.ts` 同一套候选路径）。 */
function resolveUpstreamPackageDir(): string {
  const candidates = [
    resolve(REPO_ROOT, "packages/bmap-vue/node_modules/@baidumap/jsapi-v4-types"),
    resolve(REPO_ROOT, "node_modules/@baidumap/jsapi-v4-types"),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
  }
  throw new Error(
    `未找到已安装的 @baidumap/jsapi-v4-types。先跑 \`pnpm install\`；候选路径：${candidates.join(", ")}`,
  );
}

/**
 * 从上游 `core/MapEvent.d.ts` 的 `interface MapEventMap` 里取出成员名。
 *
 * 用 TypeScript 自己的 AST 而不是正则：成员前的 JSDoc、可选标记与顺序变化都不影响结果。
 */
function readUpstreamMapEventNames(): string[] {
  const file = join(resolveUpstreamPackageDir(), "core/MapEvent.d.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "MapEventMap") {
      for (const member of node.members) {
        const name = member.name;
        if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
          names.push(name.text);
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  // 空转守卫：接口改名/搬家时不能静默得到「两个空集合相等」
  expect(names.length, "上游 MapEventMap 的成员解析结果为空，解析方式可能已失效").toBeGreaterThan(20);
  expect(new Set(names).size, "上游 MapEventMap 有重复成员").toBe(names.length);
  return names;
}

const upstreamNames = readUpstreamMapEventNames();
const declaredSdkNames = MAP_EVENT_NAMES.filter((name) => MAP_EVENT_CATALOG[name].declared).map(
  (name) => MAP_EVENT_CATALOG[name].sdk,
);
const runtimeOnlySdkNames = MAP_EVENT_NAMES.filter(
  (name) => !MAP_EVENT_CATALOG[name].declared,
).map((name) => MAP_EVENT_CATALOG[name].sdk);

describe("#28 Catalog ↔ 上游 MapEventMap（双向取差集）", () => {
  it("上游声明的每个事件都在 Catalog 里（不遗漏）", () => {
    expect([...new Set(upstreamNames)].filter((name) => !declaredSdkNames.includes(name))).toEqual(
      [],
    );
  });

  it("Catalog 里 declared 的每个事件上游都声明了（不臆造）", () => {
    expect(declaredSdkNames.filter((name) => !upstreamNames.includes(name))).toEqual([]);
  });

  it("运行时可观察但上游未声明的事件，恰好是 headingchange / tiltchange", () => {
    // 两个方向都断言：既不多也不少（多一个就是「臆造上游事件」，少一个就是「悄悄丢了 #27 依赖的事件」）
    expect([...runtimeOnlySdkNames].sort()).toEqual(["headingchange", "tiltchange"]);
  });

  it("Catalog 覆盖 41 个上游事件 + 2 个运行时事件", () => {
    expect(declaredSdkNames).toHaveLength(41);
    expect(MAP_EVENT_NAMES).toHaveLength(43);
    expect(new Set(declaredSdkNames).size).toBe(41);
  });
});

describe("#28 SDK 名 → Vue 名（kebab）推导", () => {
  it("每条都满足 vue === sdk.replace(/_/g, '-')", () => {
    for (const vue of MAP_EVENT_NAMES) {
      expect(MAP_EVENT_CATALOG[vue].sdk, `${vue} 的推导不成立`).toBe(toSdkEventName(vue));
      expect(toVueEventName(MAP_EVENT_CATALOG[vue].sdk)).toBe(vue);
    }
  });

  it("正例：带下划线的 SDK 名真的被 kebab 化（不是恒等映射）", () => {
    // 守卫：若这张表全是不带分隔符的事件，上面的推导会退化成恒等式而永远成立
    const kebabed = MAP_EVENT_NAMES.filter((vue) => MAP_EVENT_CATALOG[vue].sdk !== vue);
    expect(kebabed.sort()).toEqual([
      "language-change",
      "style-loaded",
      "style-loaded-error",
      "style-loaded-timeout",
      "style-willchange",
    ]);
    expect(MAP_EVENT_CATALOG["style-loaded"].sdk).toBe("style_loaded");
  });

  it("反例：不给上游没有词边界的事件拆词（maptypechange 就是 maptypechange）", () => {
    for (const name of ["maptypechange", "tilesloaded", "zoomexceeded", "rightdblclick"]) {
      expect(MAP_EVENT_CATALOG[name]).toBeDefined();
      expect(MAP_EVENT_CATALOG[name].sdk).toBe(name);
    }
    expect(MAP_EVENT_NAMES).not.toContain("map-type-change");
  });

  it("不同条目归一化后不撞车", () => {
    const byKey = new Map<string, string[]>();
    for (const vue of MAP_EVENT_NAMES) {
      for (const spelling of [vue, MAP_EVENT_CATALOG[vue].sdk]) {
        const key = normalizeEventKey(spelling);
        byKey.set(key, [...(byKey.get(key) ?? []), vue]);
      }
    }
    const collisions = [...byKey.entries()]
      .filter(([, owners]) => new Set(owners).size > 1)
      .map(([key, owners]) => `${key} → ${[...new Set(owners)].join(", ")}`);
    expect(collisions).toEqual([]);
  });
});

describe("#28 resolveMapEventName：任一种拼写都命中同一条目", () => {
  it("规范名 / SDK 名 / 驼峰 / 大写 都解析到同一条", () => {
    for (const spelling of ["style-loaded", "style_loaded", "styleLoaded", "STYLE_LOADED"]) {
      expect(resolveMapEventName(spelling)?.vue, spelling).toBe("style-loaded");
      expect(resolveMapEventName(spelling)?.sdk, spelling).toBe("style_loaded");
    }
    for (const spelling of ["maptypechange", "mapTypeChange", "MAPTYPECHANGE"]) {
      expect(resolveMapEventName(spelling)?.vue, spelling).toBe("maptypechange");
    }
    expect(resolveMapEventName("click")?.vue).toBe("click");
    expect(resolveMapEventName("click")?.coalesce).toBe(false);
    expect(resolveMapEventName("moving")?.coalesce).toBe(true);
  });

  it("Catalog 之外的名字返回 undefined（raw 逃生口的判据，不静默降级）", () => {
    expect(resolveMapEventName("someFutureEvent")).toBeUndefined();
    expect(resolveMapEventName("")).toBeUndefined();
  });

  it("EMIT 别名表 = 所有 sdk !== vue 的条目，且别名能解析回规范名", () => {
    const owners = Object.keys(MAP_EVENT_EMIT_ALIASES).sort();
    expect(owners).toEqual(
      MAP_EVENT_NAMES.filter((name) => MAP_EVENT_CATALOG[name].sdk !== name).sort(),
    );
    expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) {
      for (const alias of MAP_EVENT_EMIT_ALIASES[owner]!) {
        expect(resolveMapEventName(alias)?.vue, `${alias} 应解析回 ${owner}`).toBe(owner);
      }
    }
  });
});

describe("#28 高频事件的合帧标记", () => {
  it("合帧的恰好是这 5 个持续型事件", () => {
    expect(MAP_EVENT_NAMES.filter((name) => MAP_EVENT_CATALOG[name].coalesce).sort()).toEqual([
      "dragging",
      "mousemove",
      "moving",
      "touchmove",
      "zooming",
    ]);
  });

  it("start/end 与离散输入不合帧（mousewheel 每次都有独立的 trend）", () => {
    for (const name of ["movestart", "moveend", "zoomstart", "zoomend", "dragstart", "dragend"]) {
      expect(MAP_EVENT_CATALOG[name as keyof typeof MAP_EVENT_CATALOG].coalesce, name).toBe(false);
    }
    expect(MAP_EVENT_CATALOG.mousewheel.coalesce).toBe(false);
  });
});

describe("#28 payload 种类 ↔ Driver 的两张表", () => {
  const catalogPointerSdkNames = MAP_EVENT_NAMES.filter(
    (name) => MAP_EVENT_CATALOG[name].payload === "pointer",
  ).map((name) => MAP_EVENT_CATALOG[name].sdk);

  it("两处逐项相等（任一方向多一个都红）", () => {
    expect([...catalogPointerSdkNames].sort()).toEqual([...POINTER_EVENT_NAMES].sort());
    expect(catalogPointerSdkNames.length).toBeGreaterThan(0);
  });

  it("fixture：真实归一化函数喂空 raw，`point` 的有无与标记一致", () => {
    const geometry = createJsapiV4GeometryDriver(createFakeBMapV4().namespace);
    const mismatches: string[] = [];
    for (const vue of MAP_EVENT_NAMES) {
      const sdk = MAP_EVENT_CATALOG[vue].sdk;
      const payload = normalizeDriverEvent(sdk, {}, geometry);
      const hasPoint = payload.point !== undefined;
      const expectsPoint = MAP_EVENT_CATALOG[vue].payload === "pointer";
      if (hasPoint !== expectsPoint) {
        mismatches.push(`${sdk}: point=${String(hasPoint)} 而 payload=${MAP_EVENT_CATALOG[vue].payload}`);
      }
      // 订阅名恒被写进 payload.type（`MapEventPayload` 把 `type` 收成必填的依据）
      expect(payload.type, sdk).toBe(sdk);
    }
    expect(mismatches).toEqual([]);
  });

  it("读回补齐表与 payload 种类逐项相等（两处必须同时改）", () => {
    const readbackEntries = MAP_EVENT_NAMES.filter((name) =>
      Object.prototype.hasOwnProperty.call(MAP_EVENT_READBACK_FIELDS, MAP_EVENT_CATALOG[name].sdk),
    ).map((name) => MAP_EVENT_CATALOG[name].sdk);
    const enrichedKinds = MAP_EVENT_NAMES.filter(
      (name) => MAP_EVENT_CATALOG[name].payload === "load" ||
        MAP_EVENT_CATALOG[name].payload === "resize" ||
        MAP_EVENT_CATALOG[name].payload === "maptypechange",
    ).map((name) => MAP_EVENT_CATALOG[name].sdk);
    expect(readbackEntries.length, "读回表非空（否则下面的比对是空转）").toBeGreaterThan(0);
    expect([...readbackEntries].sort()).toEqual([...enrichedKinds].sort());
    // 每个种类对应的字段固定（改了字段名/数量就必须同步改 Catalog 的类型）
    expect(MAP_EVENT_READBACK_FIELDS.load).toEqual(["point", "zoom"]);
    expect(MAP_EVENT_READBACK_FIELDS.resize).toEqual(["size"]);
    expect(MAP_EVENT_READBACK_FIELDS.maptypechange).toEqual(["zoomLevel"]);
  });

  it("fixture：走真实 Driver 时，raw 缺字段的必填项由读回地图补齐（load / resize / maptypechange）", async () => {
    const { client, fake } = await createFakeV4Client();
    const map = client.driver.map.create(sizedContainer());
    const raw = fake.createdMaps[fake.createdMaps.length - 1]!;
    raw.centerAndZoom(new fake.namespace.Point(116.4, 39.9), 12);
    // 关掉 Fake 自己派发 load 的时机，这里只验证「订阅者拿到的载荷」
    const seen: Array<Record<string, unknown>> = [];
    const offLoad = client.driver.events.on(map, "load", (event) => seen.push(event as Record<string, unknown>));
    const offResize = client.driver.events.on(map, "resize", (event) => seen.push(event as Record<string, unknown>));
    const offType = client.driver.events.on(map, "maptypechange", (event) => seen.push(event as Record<string, unknown>));

    raw.emit("load", {});
    raw.emit("resize", {});
    raw.emit("maptypechange", {});

    expect(seen[0], "load.point / load.zoom 由 getCenter / getZoom 补齐").toMatchObject({
      point: { lng: 116.4, lat: 39.9 },
      zoom: 12,
    });
    expect(seen[1], "resize.size 由 getSize 补齐").toMatchObject({ size: { width: 320, height: 240 } });
    expect(seen[2], "maptypechange.zoomLevel 由 getZoom 补齐").toMatchObject({ zoomLevel: 12 });
    offLoad();
    offResize();
    offType();
    client.driver.map.destroy(map);
  });

  it("fixture：raw 给了值就用 raw 的（读回不覆盖真实数据）", async () => {
    const { client, fake } = await createFakeV4Client();
    const map = client.driver.map.create(sizedContainer());
    const raw = fake.createdMaps[fake.createdMaps.length - 1]!;
    raw.centerAndZoom(new fake.namespace.Point(116.4, 39.9), 12);
    let payload: Record<string, unknown> | null = null;
    const off = client.driver.events.on(map, "load", (event) => {
      payload = event as Record<string, unknown>;
    });
    raw.emit("load", { point: { lng: 1, lat: 2 }, zoom: 3 });
    expect(payload).toMatchObject({ point: { lng: 1, lat: 2 }, zoom: 3 });
    off();
    client.driver.map.destroy(map);
  });

  it("fixture：raw 带坐标时用的是 raw 的坐标（兜底不覆盖真实值）", () => {
    const geometry = createJsapiV4GeometryDriver(createFakeBMapV4().namespace);
    const payload = normalizeDriverEvent("click", { point: { lng: 116.4, lat: 39.9 } }, geometry);
    expect(payload.point).toEqual({ lng: 116.4, lat: 39.9 });
  });

  it("fixture：两个归一化入口的坐标优先级一致（point → latLng → 顶层 lng/lat → 指针兜底）", () => {
    const geometry = createJsapiV4GeometryDriver(createFakeBMapV4().namespace);
    const driverPoint = (raw: Record<string, unknown>) =>
      normalizeDriverEvent("click", raw, geometry).point;
    const mousePoint = (raw: Record<string, unknown>) => normalizeMapMouseEvent(raw, geometry).point;

    // 顶层 lng/lat：旧 `@click` 契约认这一形态（`<Map @click>` 已经换到 Driver 路径，
    // 两个入口必须给出同一个答案，否则真实点会被兜底成 0/0）
    expect(driverPoint({ lng: 1, lat: 2 })).toEqual({ lng: 1, lat: 2 });
    expect(mousePoint({ lng: 1, lat: 2 })).toEqual({ lng: 1, lat: 2 });
    // latLng：4.0 图形覆盖物事件的形态
    expect(driverPoint({ latLng: { lng: 3, lat: 4 } })).toEqual({ lng: 3, lat: 4 });
    expect(mousePoint({ latLng: { lng: 3, lat: 4 } })).toEqual({ lng: 3, lat: 4 });
    // `point` 优先于其它两种
    expect(
      driverPoint({ point: { lng: 5, lat: 6 }, latLng: { lng: 9, lat: 9 }, lng: 9, lat: 9 }),
    ).toEqual({ lng: 5, lat: 6 });
    // 三种都没有 ⇒ 指针类兜底一致
    expect(driverPoint({})).toEqual({ lng: 0, lat: 0 });
    expect(mousePoint({})).toEqual({ lng: 0, lat: 0 });
  });

  it("fixture：归一化补齐了 DriverEvent 新增的三个字段（trend / mapType / exMapType）", () => {
    const geometry = createJsapiV4GeometryDriver(createFakeBMapV4().namespace);
    const wheel = normalizeDriverEvent("mousewheel", { trend: true }, geometry);
    expect(wheel.trend).toBe(true);
    // 非布尔 trend 不得被当成布尔（`"true"` 这类字符串按缺失处理）
    expect(normalizeDriverEvent("mousewheel", { trend: "true" }, geometry).trend).toBeUndefined();

    const previous = { kind: "normal" };
    const next = { kind: "satellite" };
    const changed = normalizeDriverEvent(
      "maptypechange",
      { mapType: next, exMapType: previous },
      geometry,
    );
    expect(changed.mapType).toBe(next);
    expect(changed.exMapType).toBe(previous);
  });
});

describe("#28 组件级事件表", () => {
  it("组件级事件不带历史别名（旧名 `initd` 已随 #136 删除，1.0 不提供迁移路径）", () => {
    // 反证：表里任何一条都不得再有 `aliases`，`initd` 也不得作为独立条目复活
    for (const [name, entry] of Object.entries(BMAP_COMPONENT_EVENT_CATALOG)) {
      expect(Object.keys(entry), `${name} 不得带 aliases`).toEqual(["description"]);
    }
    expect(Object.keys(BMAP_COMPONENT_EVENT_CATALOG)).not.toContain("initd");
  });

  it("`<Map>` 只发规范名：源码里不出现 `initd` 字面量", () => {
    const code = stripComments(readFileSync(BMAP_SFC, "utf8"));
    expect(code).not.toContain('"initd"');
    expect(code).not.toContain("'initd'");
  });

  it("上下文归属的生命周期事件清单是精确的（目前只有 destroy）", () => {
    // 精确列表：这张表决定 `useMapEvent` 把订阅登记在谁的 scope 上，改动必须是显式的
    expect([...MAP_CONTEXT_OWNED_EVENTS]).toEqual(["destroy"]);
    for (const name of MAP_CONTEXT_OWNED_EVENTS) {
      expect(MAP_EVENT_NAMES, `${name} 必须在 Catalog 里`).toContain(name);
    }
    // 反例：`load` 不在这里 —— 它在起点派发，订阅按调用方作用域释放即可
    expect(MAP_CONTEXT_OWNED_EVENTS).not.toContain("load");
  });

  it("每条都有说明（文档表格由它生成）", () => {
    for (const [name, entry] of Object.entries(BMAP_COMPONENT_EVENT_CATALOG)) {
      expect(entry.description.length, name).toBeGreaterThan(0);
    }
  });
});

describe("#28 文档镜像：com-events.md 的 map 事件表与本表逐条相等", () => {
  /**
   * 解析文档里的 map 事件表行：`| \`@name\` | \`sdk\` | 说明 |`。
   *
   * 表格是**镜像**而不是抄件：名字与说明都必须与本表逐字相等，否则文档一漂移就会被抓到。
   */
  function readDocumentedRows(): Array<{ vue: string; sdk: string; description: string }> {
    const text = readFileSync(DOCS_EVENTS_PAGE, "utf8");
    const rows: Array<{ vue: string; sdk: string; description: string }> = [];
    for (const line of text.split("\n")) {
      const match = /^\|\s*`@([A-Za-z0-9:_-]+)`\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
      if (!match) continue;
      rows.push({ vue: match[1]!, sdk: match[2]!, description: match[3]! });
    }
    expect(rows.length, "文档里的 map 事件表解析结果为空，格式可能已变").toBeGreaterThan(20);
    return rows;
  }

  it("文档行与本表逐条相等（名字 + SDK 名 + 说明）", () => {
    const documented = readDocumentedRows();
    expect(documented.map((row) => row.vue)).toEqual([...MAP_EVENT_NAMES]);
    expect(
      documented.map((row) => row.sdk),
      "文档里的 SDK 名必须与 Catalog 一致",
    ).toEqual(MAP_EVENT_NAMES.map((name) => MAP_EVENT_CATALOG[name].sdk));
    expect(documented.map((row) => row.description)).toEqual(
      MAP_EVENT_NAMES.map((name) => MAP_EVENT_CATALOG[name].description),
    );
  });

  it("组件事件表也在文档里（每条都能在页面上查到）", () => {
    const text = readFileSync(DOCS_EVENTS_PAGE, "utf8");
    for (const name of Object.keys(BMAP_COMPONENT_EVENT_CATALOG)) {
      expect(text, `文档缺少组件事件 ${name}`).toContain(`\`${name}\``);
    }
  });
});
