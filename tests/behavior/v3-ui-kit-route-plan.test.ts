/**
 * BRoutePlan 的构造 / 释放 / 事件 / 动作（UIKIT-02 / issue #75）
 *
 * 这个组件的判别点在**请求与事件的边界**上，所以用例分三类：
 *
 * 1. **Promise 与事件是同一条错误**：上游 `searchByType()` 先 `emit("error", e)` 再抛同一个
 *    `e`；本库包成 `BMapError` 之后必须维持「事件里看到的」===「`await` 拿到的」，
 *    否则调用方要重新拼线索。夹具照抄了上游的 emit-then-reject 顺序，这条才不是自证。
 * 2. **坐标一律经 Driver**：上游把 `start` / `end` / `waypoints` 直接塞进请求，
 *    裸 `{ lng, lat }` 会被 SDK 的 `instanceof` 校验挡掉 —— 因此断言点落在
 *    「Driver 的 `toRawPoint()` 被调用了几次、参数是什么」上，而不是「没抛错」。
 * 3. **不冒充上游没有的能力**：`switchType` 在锁定版本里是 no-op / 只 warn，本库不暴露它；
 *    `typechange` 照常转发但不可达（`enabledTypes` 硬编码 `["driving"]`，形状锁在
 *    `v3-ui-kit-widget-contract.test.ts`）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import BRoutePlan from "../../packages/baidu-map-gl-vue/src/integrations/ui-kit/components/BRoutePlan.vue";
import {
  FakeUiKitRoutePlan,
  createFakeMapHarness,
  createFakeUiKit,
  installFakeUiKit,
  mountInMap,
  upstreamRouteResult,
  type FakeMapHarness,
  type FakeUiKit,
} from "./ui-kit-harness";

vi.mock("@baidumap/jsapi-ui-kit", async () => {
  const harness = await import("./ui-kit-harness");
  return harness.uiKitModuleMock();
});

interface RouteApi extends Record<string, unknown> {
  status: string;
  search(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  clear(): Promise<void>;
  getCurrentType(): Promise<string>;
  getLastResult(): Promise<Record<string, unknown> | null>;
}

interface RouteErrorLike {
  code?: string;
  message: string;
  cause?: unknown;
  toJSON(): unknown;
}

let fake: FakeUiKit;

beforeEach(() => {
  fake = createFakeUiKit();
  installFakeUiKit(fake);
});

function readyHarness(label = "map-a"): FakeMapHarness {
  const harness = createFakeMapHarness();
  harness.ready(harness.makeMapHandle(label));
  return harness;
}

function emittedOf(mounted: { child: { emitted(): unknown } }): Record<string, unknown[][] | undefined> {
  return mounted.child.emitted() as Record<string, unknown[][] | undefined>;
}

function routeWidget(): FakeUiKitRoutePlan {
  return fake.instances[0] as FakeUiKitRoutePlan;
}

/** 一次正常的驾车搜索入参（纯数据坐标 + 显式名称）。 */
function searchOptions(): Record<string, unknown> {
  return {
    start: { lng: 116.404, lat: 39.915 },
    end: { lng: 116.305, lat: 39.982 },
    startName: "起点",
    endName: "终点",
  };
}

describe("BRoutePlan：构造与选项", () => {
  it("Map ready 后构造：drivingOptions 透传、六个上游事件全部绑上", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {
      drivingOptions: { policy: 5, alternatives: 2 },
    });
    await flushPromises();

    expect(fake.stats.created).toBe(1);
    const widget = routeWidget();
    expect(widget.options.map).toEqual({ __fakeMap: "map-a" });
    expect(widget.options.drivingOptions).toEqual({ policy: 5, alternatives: 2 });
    // 正证守卫：上游 `on()` 声明支持的六个事件都绑上了（否则解绑计数守恒是空转）。
    expect(fake.stats.onCount).toBe(6);
    expect([...widget.listeners.keys()].sort()).toEqual([
      "clear",
      "error",
      "navclick",
      "planselect",
      "result",
      "typechange",
    ]);
    expect((mounted.exposed.value as unknown as RouteApi).status).toBe("ready");

    mounted.unmount();
  });

  it("没给 drivingOptions 时不往构造选项里塞一个 undefined", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();

    expect("drivingOptions" in routeWidget().options).toBe(false);
    mounted.unmount();
  });

  it("drivingOptions 变更 → 重建 widget（上游没有 setter）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap<{ drivingOptions?: Record<string, number> }>(BRoutePlan, harness, {
      drivingOptions: { policy: 0 },
    });
    await flushPromises();
    const first = routeWidget();
    expect(first.options.drivingOptions).toEqual({ policy: 0 });

    mounted.props.value = { drivingOptions: { policy: 11 } };
    await flushPromises();

    expect(fake.stats.created).toBe(2);
    expect(first.destroyed).toBe(true);
    expect((fake.instances[1] as FakeUiKitRoutePlan).options.drivingOptions).toEqual({ policy: 11 });
    expect([...first.listeners.values()].map((set) => set.size)).toEqual([0, 0, 0, 0, 0, 0]);

    mounted.unmount();
    await flushPromises();
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });
});

describe("BRoutePlan：search 动作", () => {
  it("坐标经 Driver 转成引擎原生点后再交给上游，返回值投影成纯数据", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    const result = await api.search(searchOptions());

    // 上游拿到的是 Driver 转换后的点（裸 `{ lng, lat }` 会被 SDK 的 instanceof 校验挡掉）。
    expect(harness.toRawPointCalls).toEqual([
      { lng: 116.404, lat: 39.915 },
      { lng: 116.305, lat: 39.982 },
    ]);
    expect(routeWidget().callsOf("search")).toEqual([
      {
        method: "search",
        args: [
          {
            start: { __rawPoint: true, lng: 116.404, lat: 39.915 },
            end: { __rawPoint: true, lng: 116.305, lat: 39.982 },
            startName: "起点",
            endName: "终点",
          },
        ],
      },
    ]);

    // 返回值与 `result` 事件同一形状：上游的 `routeType` 归一成 `type`。
    expect(result).toEqual({
      type: "driving",
      start: { title: "起点", location: { lng: 116.404, lat: 39.915 } },
      end: { title: "终点", location: { lng: 116.305, lat: 39.982 } },
      plans: [
        {
          distance: 1234,
          distanceText: "1.2公里",
          duration: 300,
          durationText: "5分钟",
          toll: 0,
          trafficLights: 3,
          path: [
            { lng: 116.404, lat: 39.915 },
            { lng: 116.305, lat: 39.982 },
          ],
          segments: [
            {
              type: "drive",
              distance: 1234,
              distanceText: "1.2公里",
              description: "沿上地十街行驶",
              roadName: "上地十街",
              duration: 300,
              location: { lng: 116.404, lat: 39.915 },
              path: [{ lng: 116.404, lat: 39.915 }],
            },
          ],
        },
      ],
    });

    mounted.unmount();
  });

  it("字符串端点（地点名 / uid）原样透传，不经过 Driver；waypoints 逐点转换", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    await api.search({
      start: "百度大厦",
      end: "中关村",
      startUid: "uid-a",
      waypoints: [{ lng: 116.35, lat: 39.95 }],
    });

    expect(harness.toRawPointCalls).toEqual([{ lng: 116.35, lat: 39.95 }]);
    expect(routeWidget().callsOf("search")[0]!.args[0]).toEqual({
      start: "百度大厦",
      end: "中关村",
      startUid: "uid-a",
      waypoints: [{ __rawPoint: true, lng: 116.35, lat: 39.95 }],
    });

    mounted.unmount();
  });

  it("失败：事件载荷与动作拒绝是**同一条** BMapError", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    const upstreamError = new Error("未找到驾车路线");
    routeWidget().searchError = upstreamError;

    const rejected = (await api.search(searchOptions()).catch((error: unknown) => error)) as RouteErrorLike;
    await nextTick();

    expect(rejected).toMatchObject({ code: "BMAP_SERVICE_FAILED" });
    expect(rejected.message).toContain("未找到驾车路线");
    // 「事件里看到的」与「await 拿到的」必须是同一个对象，而不是两条长得像的错误。
    expect(emittedOf(mounted).error?.[0]?.[0]).toBe(rejected);

    mounted.unmount();
  });

  it("失败文案脱敏：message / cause.message / toJSON() 三处都不含 ak", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    // UI Kit 的请求 URL 里带 `ak=`（发布产物里是 `...&fromproduct=jsapi&ak=${a}`）。
    // 上游今天不把 URL 写进错误，但 `cause` 是对外出口（toJSON / 上报工具都会读），
    // 所以任何一层出现 ak 都必须是脱敏过的。
    const upstreamError = new Error(
      "request failed: https://api.map.baidu.com/drct?ie=utf-8&fromproduct=jsapi&ak=AbCdEfGhIjKlMnOpQrSt",
    );
    routeWidget().searchError = upstreamError;

    const rejected = (await api.search(searchOptions()).catch((error: unknown) => error)) as RouteErrorLike;
    expect(rejected.message).not.toContain("AbCdEfGhIjKlMnOpQrSt");

    const cause = rejected.cause as { message?: string; stack?: string } | undefined;
    expect(cause?.message ?? "").not.toContain("AbCdEfGhIjKlMnOpQrSt");
    expect(cause?.stack ?? "").not.toContain("AbCdEfGhIjKlMnOpQrSt");
    expect(JSON.stringify(rejected.toJSON())).not.toContain("AbCdEfGhIjKlMnOpQrSt");
    // 正证守卫：脱敏确实作用在**真的含 ak** 的文本上（否则上面几条可能只是文案里本来就没有）。
    expect(upstreamError.message).toContain("ak=AbCdEfGhIjKlMnOpQrSt");
    expect(cause?.message).toContain("ak=***");

    mounted.unmount();
  });

  it("回包形状不认识：拒绝而不是用「空结果」冒充成功", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    // 缺 `routeType` / `type` → 无法判断这是哪一类路线，不能凭空给一个结果。
    routeWidget().searchResult = { plans: [] };
    const rejected = (await api.search(searchOptions()).catch((error: unknown) => error)) as RouteErrorLike;
    expect(rejected).toMatchObject({ code: "BMAP_SERVICE_FAILED" });
    expect(rejected.message).toContain("无法识别");

    mounted.unmount();
  });

  it("未就绪时动作等待就绪；卸载后动作明确拒绝", async () => {
    const harness = createFakeMapHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    const pending = api.search(searchOptions());
    await flushPromises();
    expect(fake.stats.created).toBe(0);
    expect(harness.toRawPointCalls).toEqual([]);

    harness.ready(harness.makeMapHandle("m"));
    await pending;
    expect(fake.stats.created).toBe(1);

    mounted.unmount();
    await flushPromises();
    expect(api.status).toBe("disposed");
    await expect(api.search(searchOptions())).rejects.toMatchObject({
      code: "BMAP_RESOURCE_DISPOSED",
    });
    await expect(api.clear()).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
  });
});

describe("BRoutePlan：事件 → 公共 DTO", () => {
  it("result：起点 / 终点 / 方案 / 路段逐字段投影，判别键不认识的项被丢弃", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();

    routeWidget().emit("result", {
      type: "driving",
      start: { title: "起点", location: { lng: 116.404, lat: 39.915 }, uid: "s" },
      end: { title: "终点", location: { lng: 116.305, lat: 39.982 } },
      plans: [
        {
          distance: 100,
          distanceText: "100米",
          duration: 60,
          durationText: "1分钟",
          tag: "一路畅通|时间少",
          walkDistance: "20米",
          waypoints: ["途经点"],
          transitType: 0,
          trafficLights: 1,
          path: [{ lng: 116.4, lat: 39.9 }],
          segments: [
            { type: "walk", distance: 10, distanceText: "10米", description: "步行" },
            // 判别键不认识 → 丢弃这一项，不影响其它项。
            { type: "flying", distance: 999, distanceText: "999米" },
            // 缺 `distance` → 同样丢弃。
            { type: "walk", distanceText: "?米" },
          ],
        },
        // 缺 `duration` → 丢弃整条方案。
        { distance: 1, distanceText: "1米" },
      ],
    });
    await nextTick();

    expect(emittedOf(mounted).result?.[0]?.[0]).toEqual({
      type: "driving",
      start: { title: "起点", location: { lng: 116.404, lat: 39.915 }, uid: "s" },
      end: { title: "终点", location: { lng: 116.305, lat: 39.982 } },
      plans: [
        {
          distance: 100,
          distanceText: "100米",
          duration: 60,
          durationText: "1分钟",
          tag: "一路畅通|时间少",
          walkDistance: "20米",
          waypoints: ["途经点"],
          transitType: 0,
          trafficLights: 1,
          path: [{ lng: 116.4, lat: 39.9 }],
          segments: [{ type: "walk", distance: 10, distanceText: "10米", description: "步行" }],
        },
      ],
    });

    mounted.unmount();
  });

  it("result：形状不可用时不发事件（不制造「搜到路线了」的假信号）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();

    const widget = routeWidget();
    widget.emit("result", null);
    widget.emit("result", { type: "driving", start: { title: "s" }, end: {}, plans: [] });
    widget.emit("result", { type: "driving", start: {}, end: {}, plans: "not-an-array" });
    await nextTick();

    expect(emittedOf(mounted).result).toBeUndefined();
    mounted.unmount();
  });

  it("typechange / planselect / navclick / clear 各自投影；不可用载荷不发", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const widget = routeWidget();

    widget.emit("typechange", { type: "walking" });
    widget.emit("typechange", { type: "bogus" });
    widget.emit("planselect", {
      type: "driving",
      planIndex: 1,
      plan: { distance: 10, distanceText: "10米", duration: 5, durationText: "5秒", segments: [] },
    });
    widget.emit("planselect", { type: "driving", planIndex: 0, plan: null });
    widget.emit("navclick", { type: "driving", result: null, planIndex: 0, plan: undefined });
    widget.emit("clear");
    await nextTick();

    const emitted = emittedOf(mounted);
    expect(emitted.typechange?.[0]?.[0]).toEqual({ type: "walking" });
    // 判别键不认识 → 不发（否则调用方会收到一个 `type: undefined` 的假切换）。
    expect(emitted.typechange).toHaveLength(1);
    expect(emitted.planselect?.[0]?.[0]).toEqual({
      type: "driving",
      planIndex: 1,
      plan: { distance: 10, distanceText: "10米", duration: 5, durationText: "5秒", segments: [] },
    });
    expect(emitted.planselect).toHaveLength(1);
    // 还没搜索过就点击「开始导航」是合法场景：照常发事件，`result` 给 `null`、`plan` 省略。
    expect(emitted.navclick?.[0]?.[0]).toEqual({ type: "driving", result: null, planIndex: 0 });
    // 上游 `clear` 事件没有载荷。
    expect(emitted.clear).toEqual([[]]);

    mounted.unmount();
  });
});

describe("BRoutePlan：其它公开动作", () => {
  it("getCurrentType / getLastResult 落到上游同名方法上", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    expect(await api.getCurrentType()).toBe("driving");
    // 没搜索过 → null（而不是一个空结果）。
    expect(await api.getLastResult()).toBeNull();

    await api.search(searchOptions());
    const cached = await api.getLastResult();
    expect(cached).toMatchObject({ type: "driving" });
    expect((cached as { plans: unknown[] }).plans).toHaveLength(1);

    // `clear()` 之后上游把缓存置空，本库照实返回 null。
    await api.clear();
    expect(routeWidget().callsOf("clear")).toHaveLength(1);
    expect(await api.getLastResult()).toBeNull();

    mounted.unmount();
  });

  it("公开面不含 switchType（锁定版本里它是 no-op / 只 warn）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();

    const exposed = mounted.exposed.value ?? {};
    expect(Object.keys(exposed).sort()).toEqual([
      "clear",
      "getCurrentType",
      "getLastResult",
      "search",
      "status",
    ]);
    expect(exposed).not.toHaveProperty("switchType");

    mounted.unmount();
  });

  it("单次交互只走 UI Kit：headless 路线服务面一次都没被读到", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    await api.search(searchOptions());

    expect(harness.propertyAccesses.filter((path) => path === "driver.services")).toEqual([]);
    // 正证守卫：这条链路确实读过 Driver（坐标转换走的就是它）。
    expect(harness.propertyAccesses).toContain("driver.geometry");

    mounted.unmount();
  });

  it("卸载：先解绑六个事件再销毁，宿主 DOM 撤走", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const widget = routeWidget();

    mounted.unmount();
    await flushPromises();

    expect(fake.stats.offCount).toBe(fake.stats.onCount);
    expect(fake.stats.destroyed).toBe(1);
    expect(fake.stats.hostChildrenAtDestroy).toEqual([1]);
    expect(mounted.host.querySelector(".fake-ui-kit-widget")).toBeNull();
    expect([...widget.listeners.values()].map((set) => set.size)).toEqual([0, 0, 0, 0, 0, 0]);
    const destroyAt = fake.stats.timeline.indexOf("destroy:route-plan");
    const lastOffAt = fake.stats.timeline.map((entry) => entry.startsWith("off:")).lastIndexOf(true);
    expect(destroyAt).toBeGreaterThan(lastOffAt);
  });

  it("route-widget 的默认夹具回包形状与本库 DTO 对得上（防止夹具随口成真）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    // 夹具的 `upstreamRouteResult()` 是「上游归一化回包」的替身；它必须真的能被投影成完整 DTO，
    // 否则上面那些断言会变成「夹具与实现互相印证」。
    routeWidget().searchResult = upstreamRouteResult();
    const result = await api.search(searchOptions());
    expect(result.type).toBe("driving");
    expect(result.plans).toHaveLength(1);

    mounted.unmount();
  });

  /**
   * 快速重复调用：**钉住现状**，而不是假装有请求去重 / 取消。
   *
   * 上游没有取消入口，也没有「这是第几次请求」的标识；它自己按后到的回包改写 `lastResult`
   * 与面板。本库如果只丢旧结果，会造成「返回值 vs 面板显示」错配，比不丢更难排查。
   */
  it("连续两次 search：两次都落到上游，各自拿到自己的结算", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BRoutePlan, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as RouteApi;

    routeWidget().searchResult = upstreamRouteResult({ routeType: "driving" });
    const first = api.search(searchOptions());
    routeWidget().searchResult = upstreamRouteResult({ routeType: "driving" });
    const second = api.search(searchOptions());
    const [a, b] = await Promise.all([first, second]);

    expect(routeWidget().callsOf("search")).toHaveLength(2);
    // 两次都结算（不是第二次把第一次顶掉/取消）。
    expect(a.type).toBe("driving");
    expect(b.type).toBe("driving");
    // 上游缓存的是**最后一次**的结果；本库的 `getLastResult()` 读的就是它。
    expect(await api.getLastResult()).not.toBeNull();

    mounted.unmount();
  });

  // issue #75 验收：「路线/详情所创建资源随 clear/destroy 正确释放，多地图不相互影响」。
  it("换 Map：旧 widget 先释放，新 widget 拿到新 raw map 与当前 drivingOptions", async () => {
    const harness = readyHarness("map-a");
    const mounted = mountInMap<{ drivingOptions?: Record<string, number> }>(BRoutePlan, harness, {
      drivingOptions: { policy: 5 },
    });
    await flushPromises();
    const first = routeWidget();
    expect(first.options.map).toEqual({ __fakeMap: "map-a" });

    harness.ready(harness.makeMapHandle("map-b"));
    await flushPromises();

    const second = fake.instances[1] as FakeUiKitRoutePlan;
    expect(fake.stats.created).toBe(2);
    expect(fake.stats.destroyed).toBe(1);
    expect(second.options.map).toEqual({ __fakeMap: "map-b" });
    expect(second.options.drivingOptions).toEqual({ policy: 5 });
    expect(fake.stats.timeline.indexOf("destroy:route-plan")).toBeLessThan(
      fake.stats.timeline.indexOf("construct:route-plan", 1),
    );
    expect(first.destroyed).toBe(true);

    mounted.unmount();
    await flushPromises();
    expect(fake.stats.destroyed).toBe(2);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });

  it("多地图：各自一个 widget，卸载其中一个不牵连另一个", async () => {
    const harnessA = readyHarness("map-a");
    const harnessB = readyHarness("map-b");
    const mountedA = mountInMap(BRoutePlan, harnessA, {});
    const mountedB = mountInMap(BRoutePlan, harnessB, {});
    await flushPromises();

    expect(fake.stats.created).toBe(2);
    const widgetA = fake.instances[0] as FakeUiKitRoutePlan;
    const widgetB = fake.instances[1] as FakeUiKitRoutePlan;
    expect(widgetA.options.map).toEqual({ __fakeMap: "map-a" });
    expect(widgetB.options.map).toEqual({ __fakeMap: "map-b" });

    mountedA.unmount();
    await flushPromises();

    expect(widgetA.destroyed).toBe(true);
    expect(widgetB.destroyed).toBe(false);
    expect([...widgetB.listeners.values()].map((set) => set.size)).toEqual([1, 1, 1, 1, 1, 1]);

    mountedB.unmount();
    await flushPromises();
    expect(widgetB.destroyed).toBe(true);
    expect(fake.stats.offCount).toBe(fake.stats.onCount);
  });
});
