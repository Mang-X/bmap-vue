/**
 * v4 路线服务 Facet 单测（M7-ROUTES / issue #39）
 *
 * 覆盖 issue「测试与验收」里属于 Driver 层的那几条：**四类服务的成功 / 失败 / 空结果 / 取消 /
 * 快速重复检索 / 迟到回调**、各自合法的 endpoint 与途经点、以及 `clearResults` / 释放的无残留。
 *
 * 断言全部落在可观察事实上：Fake 的 `callLog`（真的调了哪个 SDK 入口、参数长什么样）、诊断的
 * `leaks.routeResults`（结果集有没有被 `clearResults()` 收回）、归一化结果的
 * `status` / `sdkStatus` / `error.code`。
 *
 * 这里刻意**没有**「策略表 vs 官方声明」的运行时镜像 —— 那条由 `types` 层的同名与本节末尾的
 * 反射断言锁（见 `describe("策略常量与官方声明对齐")` 的说明）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { createCapabilityRegistry } from "../capability/registry";
import type { CapabilityRegistry } from "../capability/registry";
import type { UnsupportedBehavior } from "../capability/unsupported";
import { createJsapiV4EventDriver } from "./events";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4HandleRegistry } from "./registry";
import type { JsapiV4HandleRegistry } from "./registry";
import { createJsapiV4ServiceDriver } from "./services";
import { HANDLE_BRAND } from "../types/handles";
import {
  DrivingPolicy,
  IntercityPolicy,
  TransitPolicy,
  TransitVehiclePolicy,
} from "../types/services";
import type { JsapiV4ServiceDriver } from "../types/services";
import type { RouteResult, RouteServiceHandle, ServiceCall } from "../types/services";
import type { Point } from "../types/geometry";

let fake: FakeBMapV4;
let registry: JsapiV4HandleRegistry;
let capabilities: CapabilityRegistry;
let services: JsapiV4ServiceDriver;

function buildDriver(unsupported: UnsupportedBehavior = "throw"): JsapiV4ServiceDriver {
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported,
  });
  const events = createJsapiV4EventDriver({ registry, geometry });
  return createJsapiV4ServiceDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
    events,
  });
}

const point = (lng = 116.391, lat = 39.91): Point => ({ lng, lat });

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  services = buildDriver();
});

afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */
/* 策略常量：与官方声明逐成员对齐                                                */
/* -------------------------------------------------------------------------- */

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * 从上游 `.d.ts` 里读出 `declare const <NAME>: <N>;` 的成员表。
 *
 * 读**发布产物里的声明文件**而不是 README / 文档站：声明文件是 deps 的一部分，会随版本升级，
 * 而文档可能滞后（本仓库 #71 的教训）。
 */
function upstreamMembers(fileName: string): Record<string, number> {
  const source = readFileSync(
    join(PACKAGE_ROOT, "node_modules/@baidumap/jsapi-v4-types/const", fileName),
    "utf8",
  );
  const members: Record<string, number> = {};
  for (const match of source.matchAll(/declare const (\w+):\s*(\d+);/g)) {
    const [, name, value] = match;
    if (name && value) members[name] = Number(value);
  }
  return members;
}

describe("策略常量与官方声明对齐", () => {
  /**
   * 四个策略表（`DrivingPolicy` / `TransitPolicy` / `IntercityPolicy` / `TransitVehiclePolicy`）
   * 是**自持**的（公共声明不得引用官方类型包），因此编译器不会再盯着它们。这里做**派生式逐名比对**：
   *
   * - 我们的成员名按官方前缀**派生**出官方名（只有真实改名才登记进 `alias`）；
   * - 要求两边**双射**：多一个 / 少一个 / 改名忘登记都会被 `toEqual(new Set(...))` 抓到；
   * - 再逐个成员断言数值相等。
   *
   * 为什么不是「取值集合相等」：多重集相等**不抓置换**——把两个成员的值对调，集合一模一样，而
   * 「名字配错数字」正是这条断言要拦的那类错误。派生式比对也不新增第二份事实源：官方名是从我们
   * 自己的键推出来的，只有真实改名才需要写一行 `alias`。
   */
  function expectAlignedWithUpstream(
    ours: Record<string, number>,
    upstream: Record<string, number>,
    prefix: string,
    alias: Record<string, string> = {},
  ): void {
    // 正证守卫：解析失败（文件改名 / 正则失配）时不能静默通过
    expect(Object.keys(upstream).length).toBeGreaterThan(0);

    const derived = Object.keys(ours).map((name) => alias[name] ?? `${prefix}${name}`);
    expect(new Set(derived).size).toBe(derived.length); // 派生名不重复，双射才有意义
    expect(new Set(derived)).toEqual(new Set(Object.keys(upstream)));

    for (const [name, value] of Object.entries(ours)) {
      expect(upstream[alias[name] ?? `${prefix}${name}`], `${name} 的数值`).toBe(value);
    }
  }

  it("DrivingPolicy", () => {
    expectAlignedWithUpstream(
      DrivingPolicy,
      upstreamMembers("DrivingPolicy.d.ts"),
      "BMAP_DRIVING_POLICY_",
      // 官方把「距离最短」拼成 `DESTANCE`（上游笔误）；本库用可读的名字，改名在这里显式登记
      { LEAST_DISTANCE: "BMAP_DRIVING_POLICY_DESTANCE" },
    );
  });

  it("TransitPolicy", () => {
    expectAlignedWithUpstream(
      TransitPolicy,
      upstreamMembers("TransitPolicy.d.ts"),
      "BMAP_TRANSIT_POLICY_",
    );
  });

  it("IntercityPolicy", () => {
    expectAlignedWithUpstream(
      IntercityPolicy,
      upstreamMembers("IntercityPolicy.d.ts"),
      "BMAP_INTERCITY_POLICY_",
    );
  });

  it("TransitVehiclePolicy（官方类型名叫 TransitVehicleType）", () => {
    expectAlignedWithUpstream(
      TransitVehiclePolicy,
      upstreamMembers("TransitVehicleType.d.ts"),
      "BMAP_TRANSIT_TYPE_POLICY_",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 创建面                                                                      */
/* -------------------------------------------------------------------------- */

describe("v4 路线服务：创建面", () => {
  it("驾车构造选项（策略 / 路况）真的透传到 SDK", () => {
    const handle = services.createDrivingRoute(point(), {
      policy: DrivingPolicy.AVOID_CONGESTION,
      enableTraffic: true,
    });
    expect(String(handle[HANDLE_BRAND])).toBe("service:driving-route");
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    expect(raw.options.policy).toBe(DrivingPolicy.AVOID_CONGESTION);
    expect(raw.options.enableTraffic).toBe(true);
  });

  it("公交构造选项（四项 + 路况）真的透传到 SDK；未设的项**不写**", () => {
    services.createTransitRoute("北京市", {
      policy: TransitPolicy.LEAST_TIME,
      intercityPolicy: IntercityPolicy.CHEAP_PRICE,
      transitTypePolicy: TransitVehiclePolicy.TRAIN,
      pageCapacity: 3,
    });
    const raw = fake.rawRoutes.TransitRoute[0]!;
    expect(raw.options.policy).toBe(TransitPolicy.LEAST_TIME);
    expect(raw.options.intercityPolicy).toBe(IntercityPolicy.CHEAP_PRICE);
    expect(raw.options.transitTypePolicy).toBe(TransitVehiclePolicy.TRAIN);
    expect(raw.options.pageCapacity).toBe(3);
    // 未设的项不写：写了「undefined」会让 SDK 无法区分「没设」与「显式设成 undefined」
    expect("enableTraffic" in raw.options).toBe(false);

    // 设了就真的透传（路况开关对公交同样存在）
    services.createTransitRoute("北京市", { enableTraffic: true });
    expect(fake.rawRoutes.TransitRoute[1]?.options.enableTraffic).toBe(true);
  });

  it("步行 / 骑行只接受 renderOptions：多给的策略字段**不会被转发**（不是接收后忽略）", () => {
    services.createWalkingRoute("北京市", { policy: 5 } as never);
    expect("policy" in fake.rawRoutes.WalkingRoute[0]!.options).toBe(false);
    services.createRidingRoute("北京市", { enableTraffic: true } as never);
    expect("enableTraffic" in fake.rawRoutes.RidingRoute[0]!.options).toBe(false);
  });

  it("renderOptions.map 必须是本库 MapHandle；纯 headless 时不传 map", () => {
    services.createDrivingRoute(point(), { renderOptions: { autoViewport: true } });
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    expect(raw.options.renderOptions).toEqual({ autoViewport: true });
    expect("map" in (raw.options.renderOptions as object)).toBe(false);

    expect(() =>
      services.createWalkingRoute(point(), { renderOptions: { map: {} as never } }),
    ).toThrowError(/MapHandle/);
  });

  it("运行时没有该构造器时，能力门拒绝创建（BMAP_CAPABILITY_UNSUPPORTED）", () => {
    delete (fake.namespace as unknown as Record<string, unknown>).TransitRoute;
    const limited = buildDriver();
    expect(() => limited.createTransitRoute("北京市")).toThrowError(/service\.transit-route/);
  });

  it("创建期的参数错误点名**正确的服务**（共用归一化函数不再写死 createLocalSearch）", () => {
    // 空字符串 / 非 map 句柄 / 非法 renderOptions.map 都要报「createDrivingRoute: …」
    expect(() => services.createDrivingRoute("")).toThrowError(/^createDrivingRoute: /);
    expect(() =>
      services.createDrivingRoute(point(), { renderOptions: { map: {} as never } }),
    ).toThrowError(/^createDrivingRoute: renderOptions\.map/);
    // 对照：LocalSearch 那条仍然是自己的名字
    expect(() => services.createLocalSearch("")).toThrowError(/^createLocalSearch: /);
  });

  it("驾车 + panel 只告警一次（官方文档：该属性对驾车路线规划无效）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      services.createDrivingRoute(point(), { renderOptions: { panel: "route-panel" } });
      services.createDrivingRoute(point(), { renderOptions: { panel: "route-panel" } });
      const panelWarnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((message) => message.includes("panel 对驾车路线规划无效"));
      expect(panelWarnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 结果投影                                                                    */
/* -------------------------------------------------------------------------- */

describe("v4 路线服务：结果投影", () => {
  it("驾车：方案 / 路线 / 关键点三级投影，toll 与 tollDistance 可选读取", async () => {
    const handle = services.createDrivingRoute(point());
    const result = await services.searchDrivingRoute(handle, {
      start: point(116.391, 39.91),
      end: point(116.431, 39.931),
    }).result;

    expect(result.status).toBe("success");
    expect(result.sdkStatus).toBe(0);
    const data = result.data!;
    expect(data.policy).toBe(0);
    expect(data.transitType).toBeNull(); // 驾车没有 getTransitType()
    expect(data.start?.title).toBe("起点");
    expect(data.plans).toHaveLength(1);

    const plan = data.plans[0]!;
    expect(plan.index).toBe(0);
    expect(plan.distance).toBe(1000);
    expect(plan.distanceText).toBe("1.0公里");
    expect(plan.duration).toBe(600);
    // 只在官方 `DrivingRoutePlan` 接口里声明的成员：拿得到就投影，拿不到就是 null
    expect(plan.toll).toBe(10);
    expect(plan.tollDistance).toBe(500);
    expect(plan.taxiFare).toBeNull();
    expect(plan.dragPois).toEqual([]);
    expect(plan.legs).toHaveLength(2);

    const leg = plan.legs[0]!;
    expect(leg.index).toBe(0);
    expect(leg.planIndex).toBe(0);
    expect(leg.routeType).toBe(3); // BMAP_ROUTE_TYPE_DRIVING
    expect(leg.distance).toBe(1000);
    expect(leg.path).toHaveLength(2);
    expect(leg.steps).toHaveLength(2);
    expect(leg.steps[0]!.index).toBe(0);
    expect(leg.steps[0]!.description).toBe("第0段"); // getDescription(false)：纯文本
    expect(leg.steps[0]!.distance).toBe(100);
    expect(leg.steps[0]!.position).toEqual({ lng: 116.4, lat: 39.9 });
  });

  it("步行 / 骑行：同一套投影，routeType 区分；**没有** toll 成员时为 null", async () => {
    const walking = services.createWalkingRoute("北京市");
    const walkingResult = await services.searchWalkingRoute(walking, {
      start: "天安门",
      end: "王府井",
    }).result;
    expect(walkingResult.data?.plans[0]?.legs[0]?.routeType).toBe(2); // WALKING
    expect(walkingResult.data?.plans[0]?.legs[0]?.steps).toHaveLength(2);
    // 官方只把 `getToll()` / `getTollDistance()` 声明在 `DrivingRoutePlan` 上 ⇒ 步行结果里没有它们，
    // 投影必须如实给 `null`（替身也只给驾车这两个成员，否则这条分支永远走不到）
    expect(walkingResult.data?.plans[0]?.toll).toBeNull();
    expect(walkingResult.data?.plans[0]?.tollDistance).toBeNull();
    // 步行 `WalkingRouteResult` 也没有 `policy` 字段（只有驾车 / 公交的结果声明了它）
    expect(walkingResult.data?.policy).toBeNull();

    const riding = services.createRidingRoute("北京市");
    const ridingResult = await services.searchRidingRoute(riding, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(ridingResult.data?.plans[0]?.legs[0]?.routeType).toBe(6); // RIDING
    expect(ridingResult.data?.plans[0]?.toll).toBeNull();
  });

  it("公交：按官方 getTotalType 判别步行段 / 乘车段，结果与驾车**不同构**", async () => {
    const handle = services.createTransitRoute("北京市");
    const result = await services.searchTransitRoute(handle, {
      start: "天安门",
      end: "北京西站",
    }).result;

    const data = result.data!;
    expect(data.transitType).toBe(0); // getTransitType()：市内
    const plan = data.plans[0]!;
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]!.kind).toBe("walk");
    expect(plan.walkDistance).toBe("0.4公里");
    expect(plan.linesTitle).toBe("快速公交 1 号线");

    const ride = plan.segments[1]!;
    if (ride.kind !== "line") throw new Error("第二段应该是乘车段");
    expect(ride.title).toBe("快速公交 1 号线");
    expect(ride.lineType).toBe(0); // BMAP_LINE_TYPE_BUS
    expect(ride.viaStops).toBe(5);
    expect(ride.onStop?.title).toBe("快速公交 1 号线·上车站");
    expect(ride.offStop?.title).toBe("快速公交 1 号线·下车站");
    expect(ride.distance).toBe(3000);
    expect(ride.path).toHaveLength(1);
  });

  it("载荷不是路线结果（形状不认识）时结算成 empty，而不是伪造「0 条方案」", async () => {
    const handle = services.createDrivingRoute(point());
    fake.rawRoutes.DrivingRoute[0]!.overridePayload = { foo: 1 };
    const result = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(result.status).toBe("empty");
    expect(result.data).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* 状态与失败口径                                                              */
/* -------------------------------------------------------------------------- */

describe("v4 路线服务：状态与失败口径", () => {
  it("合法回包但没有方案 ⇒ empty（查无路线，可重试）", async () => {
    const handle = services.createDrivingRoute(point());
    fake.rawRoutes.DrivingRoute[0]!.planCount = 0;
    const result = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(result.status).toBe("empty");
    expect(result.sdkStatus).toBe(0);
  });

  it("回包为 null ⇒ empty（服务不可用，没有公开原因就不假装是失败）", async () => {
    const handle = services.createWalkingRoute("北京市");
    fake.rawRoutes.WalkingRoute[0]!.overridePayload = null;
    const result = await services.searchWalkingRoute(handle, {
      start: "A",
      end: "B",
    }).result;
    expect(result.status).toBe("empty");
  });

  it("状态码 ≥ 3 走 failed 并带上官方那个码（且**优先于载荷**）", async () => {
    const handle = services.createDrivingRoute(point());
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    raw.status = 5; // BMAP_STATUS_INVALID_REQUEST
    const result = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(result.status).toBe("failed");
    expect(result.sdkStatus).toBe(5);
    expect(result.error?.code).toBe(5);
    expect(result.error?.message).toContain("非法请求");
    // 即便回包里还有一份可用的方案，也以官方状态码为准（否则会把失败读成成功）
    expect(result.data).toBeNull();
  });

  it("状态码 0..2 一律 empty：两套码表（ServiceStatus / RouteStatus）在 0..2 重叠且语义不同", async () => {
    const handle = services.createDrivingRoute(point());
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    raw.planCount = 0;
    // 2 在 `BMAP_STATUS_UNKNOWN_LOCATION`（位置未知）与 `BMAP_ROUTE_STATUS_ADDRESS`（仅返回地址
    // 信息）里含义不同，本库不猜，按 empty（可重试）上报。
    raw.status = 2;
    const result = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(result.status).toBe("empty");
    expect(result.sdkStatus).toBe(2);
    expect(result.error).toBeNull();
  });

  it("SDK 不回包 ⇒ timeout；超时后该实例不再接受新检索（迟到回包无法归属）", async () => {
    vi.useFakeTimers();
    const handle = services.createDrivingRoute(point());
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    raw.queue.auto = false;

    const pending = services.searchDrivingRoute(handle, { start: point(), end: point(116.5, 39.9) });
    vi.advanceTimersByTime(15_000);
    expect((await pending.result).status).toBe("timeout");

    const next = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(next.status).toBe("failed");
    expect(next.error?.message).toContain("取消或超时");
    expect(raw.callLog.filter((entry) => entry.startsWith("search:"))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 端点与途经点参数校验                                                        */
/* -------------------------------------------------------------------------- */

describe("v4 路线服务：端点与途经点", () => {
  it("驾车不支持关键字（字符串）端点：类型层被拒 + 运行时显式失败且**不发起请求**", async () => {
    const handle = services.createDrivingRoute(point());
    const result = await services.searchDrivingRoute(handle, {
      // 故意违反公共类型，模拟**拿不到编译期保护的 JS 调用方**。
      // `@ts-expect-error` 在这里同时是一条常驻断言：一旦有人把 `DrivingRouteEndpoint` 放宽到包含
      // `string`，这条指令就会变成「多余的指令」而编译失败 ⇒ 类型层的收窄不会静默退回去。
      // @ts-expect-error 驾车端点不接受字符串地名（官方 DrivingRoute#search 的签名里没有 string）
      start: "天安门",
      end: point(116.5, 39.9),
    }).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(result.error?.message).toContain("不支持关键字");
    expect(fake.rawRoutes.DrivingRoute[0]!.callLog.some((e) => e.startsWith("search:"))).toBe(false);
  });

  it("步行 / 骑行 / 公交支持字符串端点；空串与非法坐标显式失败", async () => {
    const walking = services.createWalkingRoute("北京市");
    const ok = await services.searchWalkingRoute(walking, { start: "天安门", end: "王府井" }).result;
    expect(ok.status).toBe("success");

    const empty = await services.searchWalkingRoute(walking, { start: "", end: "王府井" }).result;
    expect(empty.error?.code).toBe("BMAP_INVALID_ARGUMENT");

    const riding = services.createRidingRoute("北京市");
    const bad = await services.searchRidingRoute(riding, {
      start: { lng: Number.NaN, lat: 39.9 },
      end: point(116.5, 39.9),
    }).result;
    expect(bad.status).toBe("failed");
    expect(bad.error?.code).toBe("BMAP_INVALID_ARGUMENT");
  });

  it("POI 引用（uid + point + name）被转成 SDK 认得的对象，并按 uid 回显", async () => {
    const handle = services.createDrivingRoute(point());
    const result = await services.searchDrivingRoute(handle, {
      start: { uid: "poi-1", point: point(116.4, 39.9), name: "天安门" },
      end: { uid: "poi-2", point: point(116.43, 39.93) },
    }).result;

    // Fake 的 `echoEndpoint` 如实回显 SDK 真正收到的那三个字段
    expect(result.data?.start?.uid).toBe("poi-1");
    expect(result.data?.start?.title).toBe("天安门");
    expect(result.data?.end?.uid).toBe("poi-2");
    expect(result.data?.end?.title).toBe("poi-2"); // 没给 name ⇒ 标题用 uid
    // 真的按 POI 对象（而不是坐标）传给了 SDK：`callLog` 里带 uid
    expect(fake.rawRoutes.DrivingRoute[0]!.callLog.some((e) => e.includes("poi-1"))).toBe(true);
  });

  it("POI 引用缺合法坐标时显式失败（uid 失效时坐标就是定位依据）", async () => {
    const handle = services.createDrivingRoute(point());
    const result = await services.searchDrivingRoute(handle, {
      start: { uid: "poi-1", point: undefined as never },
      end: point(116.5, 39.9),
    }).result;
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
  });

  it("途经点只有驾车支持：其余服务给了就显式失败（不是接收后忽略）", async () => {
    const driving = services.createDrivingRoute(point());
    const withWaypoints = await services.searchDrivingRoute(driving, {
      start: point(116.391, 39.91),
      end: point(116.431, 39.931),
      waypoints: [point(116.41, 39.92)],
    }).result;
    expect(withWaypoints.status).toBe("success");
    expect(fake.rawRoutes.DrivingRoute[0]!.callLog.some((e) => e.includes("waypoints"))).toBe(true);

    const riding = services.createRidingRoute("北京市");
    const refused = await services.searchRidingRoute(riding, {
      start: "A",
      end: "B",
      waypoints: [point()],
    } as never).result;
    expect(refused.status).toBe("failed");
    expect(refused.error?.message).toContain("不支持途经点");
    expect(fake.rawRoutes.RidingRoute[0]!.callLog.some((e) => e.startsWith("search:"))).toBe(false);
  });

  it("途经点里出现非法坐标时显式失败", async () => {
    const handle = services.createDrivingRoute(point());
    const result = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
      waypoints: [{ lng: 1, lat: Number.POSITIVE_INFINITY }],
    }).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
  });

  it("句柄种类不对时同步抛 BMAP_INVALID_ARGUMENT（不伪装成服务失败）", () => {
    const localSearch = services.createLocalSearch("北京市");
    expect(() =>
      services.searchDrivingRoute(localSearch as never, { start: point(), end: point() }),
    ).toThrowError(/只接受 createDrivingRoute/);
    expect(() => services.disposeRoute(localSearch as never)).toThrowError(/只接受 createDrivingRoute/);
  });
});

/* -------------------------------------------------------------------------- */
/* 归属、取消与释放                                                            */
/* -------------------------------------------------------------------------- */

describe("v4 路线服务：归属、取消与释放", () => {
  it("并发被显式拒绝（一个实例一个未结算操作），且不重复发起请求", async () => {
    const handle = services.createDrivingRoute(point());
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    raw.queue.auto = false;

    const first = services.searchDrivingRoute(handle, { start: point(), end: point(116.5, 39.9) });
    const second = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.6, 39.8),
    }).result;

    expect(second.status).toBe("failed");
    expect(second.error?.message).toContain("未结算");
    expect(raw.callLog.filter((entry) => entry.startsWith("search:"))).toHaveLength(1);

    // 在飞的那一次照常结算（拒绝本次调用不会作废它）
    raw.queue.flush();
    expect((await first.result).status).toBe("success");
  });

  it("取消之后该实例不再接受检索，且迟到的回包不会污染任何调用", async () => {
    const handle = services.createDrivingRoute(point());
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    raw.queue.auto = false;

    const call = services.searchDrivingRoute(handle, { start: point(), end: point(116.5, 39.9) });
    call.cancel();
    expect((await call.result).status).toBe("canceled");

    // 迟到回包到达：没有在册操作，直接忽略（不会把结果塞给下一次调用）
    raw.queue.flush();

    const next = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(next.status).toBe("failed");
    expect(next.error?.message).toContain("取消或超时");
    expect(raw.callLog.filter((entry) => entry.startsWith("search:"))).toHaveLength(1);
  });

  it("释放之后的实例拒绝新检索；释放会把在飞调用显式失败", async () => {
    const handle = services.createDrivingRoute(point());
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    raw.queue.auto = false;

    const inflight = services.searchDrivingRoute(handle, { start: point(), end: point(116.5, 39.9) });
    services.disposeRoute(handle);
    expect((await inflight.result).status).toBe("failed");

    const afterDispose = await services.searchDrivingRoute(handle, {
      start: point(),
      end: point(116.5, 39.9),
    }).result;
    expect(afterDispose.status).toBe("failed");
    expect(afterDispose.error?.message).toContain("已被 disposeRoute() 释放");
  });

  it("clearRouteResults / disposeRoute 都走公开的 clearResults()，且释放可重试", async () => {
    const handle = services.createWalkingRoute("北京市");
    const raw = fake.rawRoutes.WalkingRoute[0]!;
    await services.searchWalkingRoute(handle, { start: "A", end: "B" }).result;

    services.clearRouteResults(handle);
    expect(raw.callLog.filter((entry) => entry === "clearResults")).toHaveLength(1);
    // 清结果之后实例仍可用（与 dispose 的差别）
    expect(
      (await services.searchWalkingRoute(handle, { start: "A", end: "B" }).result).status,
    ).toBe("success");

    // 释放时 SDK 清理抛错 ⇒ 报出来、句柄保持不可用、再次释放会重试那一句
    raw.failNextClearResults = new Error("renderer gone");
    expect(() => services.disposeRoute(handle)).toThrowError(/renderer gone/);
    expect(() => services.clearRouteResults(handle)).toThrowError(/已被 disposeRoute\(\) 释放/);
    services.disposeRoute(handle);
    expect(raw.callLog.filter((entry) => entry === "clearResults")).toHaveLength(3);
    // 幂等：再释放一次不会再打 SDK（这一句已成功记账）
    services.disposeRoute(handle);
    expect(raw.callLog.filter((entry) => entry === "clearResults")).toHaveLength(3);
  });

  it("结果集在 clearResults 后销账：泄漏门禁的 routeResults 归零", async () => {
    const driving = services.createDrivingRoute(point());
    const walking = services.createWalkingRoute("北京市");
    await services.searchDrivingRoute(driving, { start: point(), end: point(116.5, 39.9) }).result;
    await services.searchWalkingRoute(walking, { start: "A", end: "B" }).result;

    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(2);
    expect(fake.diagnostics.snapshot().activity.routeResultsDrawn).toBe(2);

    services.disposeRoute(driving);
    services.disposeRoute(walking);
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(0);
    fake.diagnostics.assertNoLeaks("route services");
  });

  it("清理期间同步触发的回包不会二次销账（重入）", async () => {
    const handle = services.createDrivingRoute(point());
    const raw = fake.rawRoutes.DrivingRoute[0]!;
    await services.searchDrivingRoute(handle, { start: point(), end: point(116.5, 39.9) }).result;
    raw.onClearResults = () => {
      services.disposeRoute(handle);
    };
    services.disposeRoute(handle);
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 四类服务的共用行为（表驱动）                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 上面几段把驾车写全了，但 issue 的验收写的是「**四类**服务成功、失败、空结果、取消、快速重复搜索
 * 和迟到 callback」。四者在实现上共用同一个 `invokeRouteSearch` 与同一份记账，因此覆盖也必须一样
 * ——否则「共用」这件事只在实现里成立、在证据里不成立。
 *
 * 每条用例只描述**领域动作**（发起检索 / 取消 / 清空），服务差异收在下面这张表里。
 */
interface RouteCaseEntry {
  name: string;
  ctor: "DrivingRoute" | "WalkingRoute" | "RidingRoute" | "TransitRoute";
  create: (driver: JsapiV4ServiceDriver) => RouteServiceHandle;
  search: (driver: JsapiV4ServiceDriver, handle: never) => ServiceCall<RouteResult<unknown>>;
}

const ROUTE_CASES: readonly RouteCaseEntry[] = [
  {
    name: "驾车",
    ctor: "DrivingRoute",
    create: (driver) => driver.createDrivingRoute(point()),
    search: (driver, handle) =>
      driver.searchDrivingRoute(handle, { start: point(), end: point(116.5, 39.9) }),
  },
  {
    name: "步行",
    ctor: "WalkingRoute",
    create: (driver) => driver.createWalkingRoute("北京市"),
    search: (driver, handle) => driver.searchWalkingRoute(handle, { start: "A", end: "B" }),
  },
  {
    name: "骑行",
    ctor: "RidingRoute",
    create: (driver) => driver.createRidingRoute("北京市"),
    search: (driver, handle) => driver.searchRidingRoute(handle, { start: "A", end: "B" }),
  },
  {
    name: "公交",
    ctor: "TransitRoute",
    create: (driver) => driver.createTransitRoute("北京市"),
    search: (driver, handle) => driver.searchTransitRoute(handle, { start: "A", end: "B" }),
  },
];

describe("v4 路线服务：四类共用行为", () => {
  it.each(ROUTE_CASES)("$name：成功与空结果（方案数 0 ⇒ empty）", async ({ ctor, create, search }) => {
    const handle = create(services);
    expect((await search(services, handle as never).result).status).toBe("success");

    fake.rawRoutes[ctor][0]!.planCount = 0;
    const empty = await search(services, handle as never).result;
    expect(empty.status).toBe("empty");
    expect(empty.data).toBeNull();
    expect(empty.error).toBeNull();
  });

  it.each(ROUTE_CASES)("$name：并发被显式拒绝，且只发起一次请求", async ({ ctor, create, search }) => {
    const handle = create(services);
    fake.rawRoutes[ctor][0]!.queue.auto = false;

    const first = search(services, handle as never);
    const second = await search(services, handle as never).result;
    expect(second.status).toBe("failed");
    expect(second.error?.message).toContain("未结算");
    expect(fake.rawRoutes[ctor][0]!.callLog.filter((e) => e.startsWith("search:"))).toHaveLength(1);

    fake.rawRoutes[ctor][0]!.queue.flush();
    expect((await first.result).status).toBe("success");
  });

  it.each(ROUTE_CASES)("$name：取消之后实例失效，迟到回包不污染后续调用", async ({ ctor, create, search }) => {
    const handle = create(services);
    const raw = fake.rawRoutes[ctor][0]!;
    raw.queue.auto = false;

    const call = search(services, handle as never);
    call.cancel();
    expect((await call.result).status).toBe("canceled");
    raw.queue.flush(); // 迟到回包到达

    const next = await search(services, handle as never).result;
    expect(next.status).toBe("failed");
    expect(next.error?.message).toContain("取消或超时");
    expect(raw.callLog.filter((e) => e.startsWith("search:"))).toHaveLength(1);
  });

  it.each(ROUTE_CASES)("$name：超时之后同样重建，且迟到回包不再有归属", async ({ ctor, create, search }) => {
    vi.useFakeTimers();
    const handle = create(services);
    const raw = fake.rawRoutes[ctor][0]!;
    raw.queue.auto = false;

    const pending = search(services, handle as never);
    vi.advanceTimersByTime(15_000);
    expect((await pending.result).status).toBe("timeout");

    raw.queue.flush();
    const next = await search(services, handle as never).result;
    expect(next.status).toBe("failed");
    expect(next.error?.message).toContain("取消或超时");
  });

  it.each(ROUTE_CASES)("$name：clear 走公开的 clearResults，结果集销账", async ({ ctor, create, search }) => {
    const handle = create(services);
    const raw = fake.rawRoutes[ctor][0]!;
    expect((await search(services, handle as never).result).status).toBe("success");
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(1);

    services.clearRouteResults(handle);
    expect(raw.callLog).toContain("clearResults");
    expect(fake.diagnostics.snapshot().leaks.routeResults).toBe(0);

    // 清结果之后实例仍可继续检索（与 dispose 的差别）
    expect((await search(services, handle as never).result).status).toBe("success");
  });

  it.each(ROUTE_CASES)("$name：句柄种类不对时同步抛（不伪装成服务失败）", ({ create }) => {
    // 先建一个路线实例（顺带确认它的句柄品牌与 LocalSearch 不同 —— 断言不是「存在性」这种恒真的东西）
    const route = create(services);
    const localSearch = services.createLocalSearch("北京市");
    expect(route[HANDLE_BRAND]).not.toBe(localSearch[HANDLE_BRAND]);
    expect(() => services.clearRouteResults(localSearch as never)).toThrowError(/只接受 create/);
    expect(() => services.disposeRoute(localSearch as never)).toThrowError(/只接受 create/);
  });
});
