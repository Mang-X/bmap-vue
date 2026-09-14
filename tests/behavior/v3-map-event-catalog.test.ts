/**
 * Map 事件 Catalog 门禁（M4-EVENTS / issue #28）
 *
 * 事件名是公共契约：`<BMap @xxx>`、`useMapEvent("xxx")` 与文档表格必须来自**同一份数据**。
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
  BMAP_COMPONENT_EVENT_ALIASES,
  BMAP_COMPONENT_EVENT_CATALOG,
  MAP_EVENT_CATALOG,
  MAP_EVENT_EMIT_ALIASES,
  MAP_EVENT_NAMES,
  normalizeEventKey,
  resolveMapEventName,
  toSdkEventName,
  toVueEventName,
} from "../../packages/baidu-map-gl-vue/src/core/events/eventCatalog";
import {
  normalizeDriverEvent,
  normalizeMapMouseEvent,
  POINTER_EVENT_NAMES,
} from "../../packages/baidu-map-gl-vue/src/driver/normalize/events";
import { createJsapiV4GeometryDriver } from "../../packages/baidu-map-gl-vue/src/driver/jsapi-v4/geometry";
import { createFakeBMapV4 } from "../../packages/test-utils/fake-bmap-v4";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DOCS_EVENTS_PAGE = resolve(REPO_ROOT, "docs/zh-CN/guide/com-events.md");
const BMAP_SFC = resolve(
  REPO_ROOT,
  "packages/baidu-map-gl-vue/src/components/map/BMap.vue",
);

/** 去掉注释后再做文本断言：文档/注释里「提到」某个标识符不算违规（与 no-bmapgl 门禁同口径）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;(){}])\/\/[^\n]*/g, "$1");
}

/** 定位上游类型包（与 `v3-upstream-types-case-patch.test.ts` 同一套候选路径）。 */
function resolveUpstreamPackageDir(): string {
  const candidates = [
    resolve(REPO_ROOT, "packages/baidu-map-gl-vue/node_modules/@baidumap/jsapi-v4-types"),
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

describe("#28 pointer 标记 ↔ Driver 兜底清单", () => {
  const catalogPointerSdkNames = MAP_EVENT_NAMES.filter(
    (name) => MAP_EVENT_CATALOG[name].pointer,
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
      if (hasPoint !== MAP_EVENT_CATALOG[vue].pointer) {
        mismatches.push(`${sdk}: point=${String(hasPoint)} 而 pointer=${String(MAP_EVENT_CATALOG[vue].pointer)}`);
      }
      // 订阅名恒被写进 payload.type（`MapEventPayload` 把 `type` 收成必填的依据）
      expect(payload.type, sdk).toBe(sdk);
    }
    expect(mismatches).toEqual([]);
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

    // 顶层 lng/lat：旧 `@click` 契约认这一形态（`<BMap @click>` 已经换到 Driver 路径，
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
  it("别名只指向规范名，且别名本身不是另一条条目（否则会重复 emit）", () => {
    expect(BMAP_COMPONENT_EVENT_ALIASES).toEqual({ initd: "ready" });
    for (const alias of Object.keys(BMAP_COMPONENT_EVENT_ALIASES)) {
      expect(Object.keys(BMAP_COMPONENT_EVENT_CATALOG)).not.toContain(alias);
    }
  });

  it("别名只在 Catalog 一处决定：BMap 里不出现别名事件名的字符串字面量", () => {
    // 正证：别名表非空（否则下面的循环一次都不跑，门禁等于不存在）
    expect(Object.keys(BMAP_COMPONENT_EVENT_ALIASES)).toEqual(["initd"]);
    const code = stripComments(readFileSync(BMAP_SFC, "utf8"));
    for (const alias of Object.keys(BMAP_COMPONENT_EVENT_ALIASES)) {
      // 判定对象是**字符串字面量**而不是某个调用形态：`emit("initd")` 与 `emitDynamic("initd", …)`
      // 都算「组件自己兼容旧名」，都必须走 Catalog 的表（#28 自审发现只匹配 `emit(` 会漏）
      expect(code, `BMap.vue 不得出现 "${alias}" 字面量`).not.toContain(`"${alias}"`);
      expect(code, `BMap.vue 不得出现 '${alias}' 字面量`).not.toContain(`'${alias}'`);
    }
    expect(code, "别名通过 Catalog 的表发出去").toContain("BMAP_COMPONENT_EVENT_EMIT_ALIASES");
  });

  it("反误报：注释里提到别名不算违规（判定对象是代码，不是文案）", () => {
    // 该写法本身写在注释里也不得命中（否则门禁会被「解释这个规则」的文字触发）
    const withComment = stripComments('// emit("initd", payload)\nconst x = 1;\n');
    expect(withComment).not.toContain('"initd"');
    // 正证：同一个字面量出现在代码里必须命中
    expect(stripComments('const y = \'emit("initd"\';\n')).toContain('"initd"');
    expect(stripComments('emitDynamic("initd", payload);\n')).toContain('"initd"');
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
