/**
 * `scripts/probe-jsonp-callback-verdicts.mts` 的三态回归守卫（issue #128 / F-2）
 *
 * 与 #98 / #110 的判定层同口径：判定层是纯函数，用**合成报告**驱动，
 * 使「缺失读数 ⇒ 无法判定」可回归验证，不依赖「下次跑探针时肉眼看」。
 *
 * - **空报告** ⇒ 每条结论都必须是第三态（主守卫）；
 * - **逐条点名**缺失 ⇒ 对应那条落第三态；
 * - **读数齐备**（正证控件）⇒ 全部结论必须是**确定**结论；
 * - **`threw` / `type` / `count` 等字段类型不对** ⇒ 同样算没测到；
 * - **COMPLETE ↔ live fixture 逐字段一致**：正证保护的必须是真实基线。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  controlFailures,
  verdicts,
  type ProbeReport,
  type Reading,
} from "../../scripts/probe-jsonp-callback-verdicts.mts";

function report(readings: Reading[]): ProbeReport {
  return { phase: "done", sdk: null, readings, console: [], error: null };
}

function lineOf(lines: string[], prefix: string): string {
  const found = lines.filter((line) => line.startsWith(prefix));
  expect(found.length, `结论里没有以 ${prefix} 开头的那一行`).toBe(1);
  return found[0]!;
}

function conclusionOf(line: string): string {
  return line.slice(line.lastIndexOf("⇒") + 1).trim();
}

/**
 * 「读数齐备」的合成报告。字段值必须与 `tests/behavior/fixtures/probe-jsonp-callback.live.json`
 * 一致（文件末尾的漂移用例做机器检查）。
 *
 * live 要点（2026-09-24 真实 AK）：官方按 `callback=NAME` 调用我们的 handler（count=1）；
 * args.length=0（走 `exportGetter` 回退）；调用时身份仍是我们的；**callback 当下 readyAtCall=true**
 * （重跑后以 fixture 为准）；foreign 释放后恢复原引用；
 * 官方新增全局为大量 `BMAP_*` 常量与 `BMap`/`BMapGL` 等（`__bmap_v4_custom_` 前缀无冲突）。
 */
const COMPLETE: Reading[] = [
  { id: "control.install", threw: false, message: null, type: "function" },
  { id: "control.callbackFired", threw: false, count: 1 },
  { id: "control.argsLength", threw: false, count: 0, rawLength: 0 },
  { id: "control.handlerIdentityAtCall", threw: false, same: true },
  { id: "control.readyAtCall", threw: false, ready: true },
  { id: "control.bmapReady", threw: false, ready: true },
  { id: "control.loadAttempt", threw: false, message: null },
  { id: "release.afterControl", threw: false, type: "absent" },
  {
    id: "globals.officialCreated",
    threw: false,
    keys: [
      "APIPack",
      "BMAPGL_LANGUAGE_EN",
      "BMAPGL_LANGUAGE_ZH",
      "BMAPGL_NORMAL_MAP",
      "BMAP_ANCHOR_BOTTOM_CENTER",
      "BMAP_ANCHOR_BOTTOM_LEFT",
      "BMAP_ANCHOR_BOTTOM_RIGHT",
      "BMAP_ANCHOR_CENTER",
      "BMAP_ANCHOR_MIDDLE_LEFT",
      "BMAP_ANCHOR_MIDDLE_RIGHT",
      "BMAP_ANCHOR_TOP_CENTER",
      "BMAP_ANCHOR_TOP_LEFT",
      "BMAP_ANCHOR_TOP_RIGHT",
      "BMAP_ANIMATION_BOUNCE",
      "BMAP_ANIMATION_DROP",
      "BMAP_ANIMATION_DROPDOWN",
      "BMAP_ANIMATION_RAISEUP",
      "BMAP_AUTHENTIC_KEY",
      "BMAP_CANVAS_DRAWER",
      "BMAP_CONTEXT_MENU_ICON_ZOOMIN",
      "BMAP_CONTEXT_MENU_ICON_ZOOMOUT",
      "BMAP_COORD_BD09",
      "BMAP_COORD_EPSG3857",
      "BMAP_COORD_GCJ02",
      "BMAP_COORD_GCJ02MERCATOR",
      "BMAP_COORD_MERCATOR",
      "BMAP_COORD_WGS84",
      "BMAP_DEFAULT_API_VERSION",
      "BMAP_DEFAULT_UI_VERSION",
      "BMAP_DRIVING_POLICY_AVOID_CONGESTION",
      "BMAP_DRIVING_POLICY_AVOID_CONGESTION_PAY",
      "BMAP_DRIVING_POLICY_AVOID_HIGHWAYS",
      "BMAP_DRIVING_POLICY_AVOID_HIGHWAYS_CONGESTION",
      "BMAP_DRIVING_POLICY_AVOID_HIGHWAYS_CONGESTION_PAY",
      "BMAP_DRIVING_POLICY_AVOID_HIGHWAYS_PAY",
      "BMAP_DRIVING_POLICY_AVOID_PAY",
      "BMAP_DRIVING_POLICY_DEFAULT",
      "BMAP_DRIVING_POLICY_DESTANCE",
      "BMAP_DRIVING_POLICY_DISTANCE_PRIORITY",
      "BMAP_DRIVING_POLICY_FIRST_HIGHWAYS",
      "BMAP_DRIVING_POLICY_HIGHWAYS_AVOID_CONGESTION",
      "BMAP_DRIVING_POLICY_TIME_PRIORITY",
      "BMAP_EARTH_MAP",
      "BMAP_HIGHLIGHT_ROUTE",
      "BMAP_HIGHLIGHT_STEP",
      "BMAP_HYBRID_MAP",
      "BMAP_INTERCITY_POLICY_CHEAP_PRICE",
      "BMAP_INTERCITY_POLICY_EARLY_START",
      "BMAP_INTERCITY_POLICY_LEAST_TIME",
      "BMAP_LANGUAGE_DE",
      "BMAP_LANGUAGE_EN",
      "BMAP_LANGUAGE_ES",
      "BMAP_LANGUAGE_FR",
      "BMAP_LANGUAGE_ID",
      "BMAP_LANGUAGE_IT",
      "BMAP_LANGUAGE_JA",
      "BMAP_LANGUAGE_KO",
      "BMAP_LANGUAGE_MS",
      "BMAP_LANGUAGE_PT",
      "BMAP_LANGUAGE_RU",
      "BMAP_LANGUAGE_TH",
      "BMAP_LANGUAGE_TR",
      "BMAP_LANGUAGE_VI",
      "BMAP_LANGUAGE_ZH",
      "BMAP_LANGUAGE_ZH_TW",
      "BMAP_LINE_TYPE_AIRPLANE",
      "BMAP_LINE_TYPE_BUS",
      "BMAP_LINE_TYPE_COACH",
      "BMAP_LINE_TYPE_FERRY",
      "BMAP_LINE_TYPE_SUBWAY",
      "BMAP_LINE_TYPE_TRAIN",
      "BMAP_MAPTYPE_CONTROL_DROPDOWN",
      "BMAP_MAPTYPE_CONTROL_HORIZONTAL",
      "BMAP_MAPTYPE_CONTROL_MAP",
      "BMAP_MODE_DRIVING",
      "BMAP_MODE_NAVIGATION",
      "BMAP_MODE_TRANSIT",
      "BMAP_MODE_WALKING",
      "BMAP_NAVIGATION_CONTROL_LARGE",
      "BMAP_NAVIGATION_CONTROL_PAN",
      "BMAP_NAVIGATION_CONTROL_SMALL",
      "BMAP_NAVIGATION_CONTROL_ZOOM",
      "BMAP_NONE_MAP",
      "BMAP_NORMAL_MAP",
      "BMAP_PANORAMA_POI_CATERING",
      "BMAP_PANORAMA_POI_HOTEL",
      "BMAP_PANORAMA_POI_INDOOR_SCENE",
      "BMAP_PANORAMA_POI_MOVIE",
      "BMAP_PANORAMA_POI_NONE",
      "BMAP_PANORAMA_POI_TRANSIT",
      "BMAP_PERSPECTIVE_MAP",
      "BMAP_POINT_DENSITY_HIGH",
      "BMAP_POINT_DENSITY_LOW",
      "BMAP_POINT_DENSITY_MEDIUM",
      "BMAP_POINT_SHAPE_CIRCLE",
      "BMAP_POINT_SHAPE_RHOMBUS",
      "BMAP_POINT_SHAPE_SQUARE",
      "BMAP_POINT_SHAPE_STAR",
      "BMAP_POINT_SHAPE_WATERDROP",
      "BMAP_POINT_SIZE_BIG",
      "BMAP_POINT_SIZE_BIGGER",
      "BMAP_POINT_SIZE_HUGE",
      "BMAP_POINT_SIZE_NORMAL",
      "BMAP_POINT_SIZE_SMALL",
      "BMAP_POINT_SIZE_SMALLER",
      "BMAP_POINT_SIZE_TINY",
      "BMAP_POI_TYPE_BUSLINE",
      "BMAP_POI_TYPE_BUSSTOP",
      "BMAP_POI_TYPE_NORMAL",
      "BMAP_POI_TYPE_SUBLINE",
      "BMAP_POI_TYPE_SUBSTOP",
      "BMAP_PROTOCOL",
      "BMAP_QT_VERSION",
      "BMAP_ROUTE_STATUS_ADDRESS",
      "BMAP_ROUTE_STATUS_EMPTY",
      "BMAP_ROUTE_STATUS_NORMAL",
      "BMAP_ROUTE_TYPE_DRIVING",
      "BMAP_ROUTE_TYPE_RIDING",
      "BMAP_ROUTE_TYPE_WALKING",
      "BMAP_SATELLITE_MAP",
      "BMAP_SHAPE_CIRCLE",
      "BMAP_SHAPE_RECT",
      "BMAP_STATUS_CITY_LIST",
      "BMAP_STATUS_INVALID_KEY",
      "BMAP_STATUS_INVALID_REQUEST",
      "BMAP_STATUS_PERMISSION_DENIED",
      "BMAP_STATUS_SERVICE_UNAVAILABLE",
      "BMAP_STATUS_SUCCESS",
      "BMAP_STATUS_TIMEOUT",
      "BMAP_STATUS_UNKNOWN_LOCATION",
      "BMAP_STATUS_UNKNOWN_ROUTE",
      "BMAP_SVG_DRAWER",
      "BMAP_SYS_DRAWER",
      "BMAP_TRAFFICE_STATUS_JAM",
      "BMAP_TRAFFICE_STATUS_NONE",
      "BMAP_TRAFFICE_STATUS_NORMAL",
      "BMAP_TRAFFICE_STATUS_SLOW",
      "BMAP_TRANSIT_PLAN_TYPE_LINE",
      "BMAP_TRANSIT_PLAN_TYPE_ROUTE",
      "BMAP_TRANSIT_POLICY_AVOID_SUBWAYS",
      "BMAP_TRANSIT_POLICY_FIRST_SUBWAYS",
      "BMAP_TRANSIT_POLICY_LEAST_TIME",
      "BMAP_TRANSIT_POLICY_LEAST_TRANSFER",
      "BMAP_TRANSIT_POLICY_LEAST_WALKING",
      "BMAP_TRANSIT_POLICY_RECOMMEND",
      "BMAP_TRANSIT_TYPE_CROSS_CITY",
      "BMAP_TRANSIT_TYPE_IN_CITY",
      "BMAP_TRANSIT_TYPE_POLICY_AIRPLANE",
      "BMAP_TRANSIT_TYPE_POLICY_COACH",
      "BMAP_TRANSIT_TYPE_POLICY_TRAIN",
      "BMAP_UNIT_IMPERIAL",
      "BMAP_UNIT_METRIC",
      "BMAP_VML_DRAWER",
      "BMap",
      "BMapGL",
      "BMapGL_loadScriptTime",
      "BMap_Symbol_SHAPE_BACKWARD_CLOSED_ARROW",
      "BMap_Symbol_SHAPE_BACKWARD_OPEN_ARROW",
      "BMap_Symbol_SHAPE_CAMERA",
      "BMap_Symbol_SHAPE_CIRCLE",
      "BMap_Symbol_SHAPE_CLOCK",
      "BMap_Symbol_SHAPE_FORWARD_CLOSED_ARROW",
      "BMap_Symbol_SHAPE_FORWARD_OPEN_ARROW",
      "BMap_Symbol_SHAPE_PLANE",
      "BMap_Symbol_SHAPE_POINT",
      "BMap_Symbol_SHAPE_RECTANGLE",
      "BMap_Symbol_SHAPE_RHOMBUS",
      "BMap_Symbol_SHAPE_SMILE",
      "BMap_Symbol_SHAPE_STAR",
      "BMap_Symbol_SHAPE_WARNING",
      "B_BUSINESS_INFO",
      "B_HOST_TILE_BASE_URLS",
      "B_HOST_TILE_ONLINE_URLS",
      "COORDINATES_51",
      "COORDINATES_BD09",
      "COORDINATES_BD09_MC",
      "COORDINATES_GCJ02",
      "COORDINATES_GCJ02_MC",
      "COORDINATES_MAPBAR",
      "COORDINATES_WGS84",
      "COORDINATES_WGS84_MC",
      "FeBrowser",
      "MSV",
      "Pano",
      "TILE_VERSION",
      "__abbaidu_2063_cb",
      "_jsload",
      "_layer",
      "d3",
      "mat2",
      "mat4",
      "md5",
      "regeneratorRuntime",
      "vec2",
      "vec3",
      "vec4"
    ],
  },
  { id: "foreign.preInstall", threw: false, type: "function", same: true },
  { id: "foreign.callbackFired", threw: false, count: 1 },
  { id: "foreign.afterRelease", threw: false, type: "function", same: true },
];

describe("[#128 F-2] JSONP 回调查针判定层的三态", () => {
  it("空报告 ⇒ 全部结论是「无法判定」（主守卫：新增结论也必须带第三态）", () => {
    const lines = verdicts(report([]));
    expect(lines.length, "结论条数变了：新增/删除结论时要同步更新本用例与 COMPLETE").toBe(3);
    const determinate = lines
      .map((line) => ({ line, conclusion: conclusionOf(line) }))
      .filter((item) => !item.conclusion.includes("无法判定"))
      .map((item) => item.line);
    expect(
      determinate,
      "读数一条都没有，却被判成了确定结论 —— 缺读数必须落第三态，不得进正/负任一分支",
    ).toEqual([]);
  });

  it("缺 control.callbackFired ⇒ 回调契约那条是第三态，不是「回调未被调用」", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "control.callbackFired"))),
      "[回调契约",
    );
    expect(line).toContain("无法判定");
    expect(line, "缺读数不得落成负结论").not.toContain("**回调未被调用**");
  });

  it("count=0 且 ready/same 在场 ⇒ 确定负结论（读到了，是坏的那一侧）", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) => (r.id === "control.callbackFired" ? { ...r, count: 0 } : r)),
        ),
      ),
      "[回调契约",
    );
    expect(line).toContain("**回调未被调用**");
    expect(line).not.toContain("无法判定");
  });

  it("same=false ⇒ 身份被覆盖那条负结论（官方先改写了全局值）", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) => (r.id === "control.handlerIdentityAtCall" ? { ...r, same: false } : r)),
        ),
      ),
      "[回调契约",
    );
    expect(line).toContain("**调用时身份已被覆盖**");
  });

  it("缺 foreign.afterRelease ⇒ foreign 那条第三态", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "foreign.afterRelease"))),
      "[foreign 捕获",
    );
    expect(line).toContain("无法判定");
    expect(line, "不得读成「释放后外部值丢失」").not.toContain("**释放后外部值丢失**");
  });

  it("foreign same=false ⇒ 未恢复原引用那条负结论", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) => (r.id === "foreign.afterRelease" ? { ...r, same: false } : r)),
        ),
      ),
      "[foreign 捕获",
    );
    expect(line).toContain("**释放后未恢复原引用**");
  });

  it("缺 globals.officialCreated ⇒ 新增全局那条第三态", () => {
    const line = lineOf(
      verdicts(report(COMPLETE.filter((r) => r.id !== "globals.officialCreated"))),
      "[官方新增全局",
    );
    expect(line).toContain("无法判定");
  });

  it("officialCreated 有键 ⇒ 确定「有新增全局」", () => {
    const line = lineOf(
      verdicts(
        report(
          COMPLETE.map((r) =>
            r.id === "globals.officialCreated" ? { ...r, keys: ["BMapSomething"] } : r,
          ),
        ),
      ),
      "[官方新增全局",
    );
    expect(line).toContain("**有新增全局**");
    expect(line).toContain("BMapSomething");
  });

  it("读数对象**在**、`count` 字段**不在** ⇒ 第三态（不得读成 count=0）", () => {
    const line = lineOf(
      verdicts(report([{ id: "control.callbackFired", threw: false } as Reading])),
      "[回调契约",
    );
    expect(line).toContain("无法判定");
  });

  it("`same` 字段类型不对（页面回传字符串）同样算没测到 ⇒ 第三态", () => {
    const readings = COMPLETE.map((r) =>
      r.id === "control.handlerIdentityAtCall"
        ? ({ id: r.id, same: "true" } as unknown as Reading)
        : r,
    );
    const line = lineOf(verdicts(report(readings)), "[回调契约");
    expect(line).toContain("无法判定");
  });

  it("正证控件：齐备时为空；缺 callbackFired / readyAtCall / identity 时点名失败", () => {
    expect(controlFailures(report(COMPLETE)), "齐备时控件成立").toEqual([]);

    const noFired = controlFailures(
      report(COMPLETE.filter((r) => r.id !== "control.callbackFired")),
    );
    expect(noFired.join("\n")).toContain("control.callbackFired");

    // readyAtCall 是控件；最终 bmapReady 只是诊断，改成 false 不应单独让控件失败
    const noReadyAtCall = controlFailures(
      report(COMPLETE.map((r) => (r.id === "control.readyAtCall" ? { ...r, ready: false } : r))),
    );
    expect(noReadyAtCall.join("\n")).toContain("control.readyAtCall");

    const readyAtCallMissing = controlFailures(
      report(COMPLETE.filter((r) => r.id !== "control.readyAtCall")),
    );
    expect(readyAtCallMissing.join("\n")).toContain("control.readyAtCall");

    const finalOnlyFalse = controlFailures(
      report(COMPLETE.map((r) => (r.id === "control.bmapReady" ? { ...r, ready: false } : r))),
    );
    expect(finalOnlyFalse, "最终 bmapReady 只是诊断，不进控件").toEqual([]);

    const noIdentity = controlFailures(
      report(
        COMPLETE.map((r) =>
          r.id === "control.handlerIdentityAtCall" ? { ...r, same: false } : r,
        ),
      ),
    );
    expect(noIdentity.join("\n")).toContain("control.handlerIdentityAtCall");

    const weakFired = controlFailures(
      report(COMPLETE.map((r) => (r.id === "control.callbackFired" ? { ...r, count: 0 } : r))),
    );
    expect(weakFired.join("\n"), "count < 1 = 回调没被调").toContain("count");
  });

  it("读数齐备 ⇒ 三条结论都是确定结论（正证：否则「永远输出无法判定」也能过）", () => {
    const lines = verdicts(report(COMPLETE));
    expect(lines.filter((line) => line.includes("无法判定"))).toEqual([]);
    expect(lineOf(lines, "[回调契约")).toContain("**callback=NAME 契约成立**");
    expect(lineOf(lines, "[foreign 捕获")).toContain("**foreign 捕获与释放可靠**");
    // live（2026-09-24）：官方加载后 window 上新增大量 BMAP_* 常量 —— 结论是「有新增全局」。
    // 冲突检查针对**键名本身**（判定层文案里会提示核对前缀，故不得对整行做 not.toContain）。
    expect(lineOf(lines, "[官方新增全局")).toContain("**有新增全局**");
    const officialKeys = COMPLETE.find((r) => r.id === "globals.officialCreated")?.keys ?? [];
    expect(officialKeys.some((key) => key.startsWith("__bmap_v4_custom_"))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 正证基线 ↔ live 报告：漂移必须在 CI 里被发现                                */
/* -------------------------------------------------------------------------- */

describe("[#128 F-2] 正证基线（COMPLETE）与 live 报告一致", () => {
  const fixturePath = join(
    process.cwd(),
    "tests/behavior/fixtures/probe-jsonp-callback.live.json",
  );
  const live = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    capturedAt: string;
    phase: string;
    readings: Reading[];
  };

  it("fixture 不是空壳（正证守卫：文件被清空 / 搬走时不得静默空转）", () => {
    expect(live.phase, `${fixturePath} 的 phase 不是 done`).toBe("done");
    expect(live.readings.length, `${fixturePath} 里的读数太少`).toBeGreaterThan(5);
  });

  it("`COMPLETE` 的每条读数都与 live 报告逐字段一致", () => {
    const byId = new Map(live.readings.map((reading) => [reading.id, reading]));
    const fields = ["type", "threw", "message", "count", "rawLength", "same", "ready", "keys"] as const;
    const drifted = COMPLETE.flatMap((expected) => {
      const actual = byId.get(expected.id);
      if (actual === undefined) return [`${expected.id}：live 报告里没有这条读数`];
      return fields.flatMap((field) => {
        if (expected[field] === undefined || actual[field] === undefined) return [];
        const a = expected[field];
        const b = actual[field];
        const equal = Array.isArray(a) && Array.isArray(b)
          ? a.length === b.length && a.every((v, i) => v === b[i])
          : a === b;
        return equal
          ? []
          : [`${expected.id}.${field}：COMPLETE=${JSON.stringify(a)} live=${JSON.stringify(b)}`];
      }).concat(
        fields
          .filter((field) => expected[field] !== undefined && actual[field] === undefined)
          .map((field) => `${expected.id}.${field}：live 缺失`),
      );
    });
    expect(
      drifted,
      `COMPLETE 与 live 报告（${live.capturedAt}）漂移了：要么改回 live 的值，要么在重跑探针` +
        `（退出码 0）之后刷新 fixture——正证保护的必须是真实基线`,
    ).toEqual([]);
  });
});
