/**
 * v4 Service Facet 单测（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 覆盖 issue「测试要求」的基础服务部分：**成功 / 空结果 / 超时 / 取消 / 迟到回调**，
 * 外加能力守卫、句柄所有权与参数校验。断言全部落在可观测事实（Fake 的 `callLog`、
 * 归一化结果的 `status`/`sdkStatus`）上。
 *
 * 「服务失败」的语义在 R25-C（#72）之后是：官方对 Geocoder / Boundary / LocalCity 只给了
 * 「回调参数是不是 `null`」这一条公开信息，因此 `null` / 空容器一律归一成 `empty`
 * （「没有结果或服务当前不可用」），**不**去嗅探 `_rd` 私有注册表、也不编造精确错误码。
 * 只有 SDK 公开给出状态码的服务（`Geolocation#getStatus()`、`Convertor#translate` 的回包
 * `status`）才会走 `failed` 并带上那个码——下面各段严格按这条口径断言。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createFakeBMapV4,
  FakeV4AutocompleteResult,
  FakeV4LocalResult,
  type FakeBMapV4,
} from "../../../../test-utils";
import { CAPABILITY_CATALOG } from "../capability/catalog";
import { createCapabilityRegistry } from "../capability/registry";
import type { CapabilityRegistry } from "../capability/registry";
import type { UnsupportedBehavior } from "../capability/unsupported";
import { createJsapiV4EventDriver } from "./events";
import type { JsapiV4EventDriver } from "./events";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4HandleRegistry } from "./registry";
import type { JsapiV4HandleRegistry } from "./registry";
import { createJsapiV4ServiceDriver } from "./services";
import type {
  BoundaryRings,
  GeocodedAddress,
  JsapiV4ServiceDriver,
  LocalSearchResult,
} from "../types/services";

let fake: FakeBMapV4;
let registry: JsapiV4HandleRegistry;
let capabilities: CapabilityRegistry;
let services: JsapiV4ServiceDriver;
let events: JsapiV4EventDriver;

function buildDriver(unsupported: UnsupportedBehavior = "throw"): JsapiV4ServiceDriver {
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported,
  });
  events = createJsapiV4EventDriver({ registry, geometry });
  return createJsapiV4ServiceDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
    events,
  });
}

/**
 * 程序化检索用的输入框：**必须不可输入**（`readOnly`）。
 *
 * `Autocomplete` 的回包通道与输入框共享：可输入的输入框上，用户输入触发的同关键词回包与程序化
 * 回包无法区分，因此 `suggest()` 会拒绝（四轮复审 P2-2）。要「通道独占」，输入框必须是
 * `readOnly` / `disabled` / `type="hidden"` 之一。
 */
function input(): HTMLInputElement {
  const el = document.createElement("input");
  el.readOnly = true;
  document.body.appendChild(el);
  return el;
}

/** 可输入的输入框（默认形态）：用于验证 `suggest()` 的「通道独占」前置拒绝。 */
function typableInput(): HTMLInputElement {
  const el = document.createElement("input");
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  services = buildDriver();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("v4 Service Facet：创建面", () => {
  it("六个基础服务 + ViewAnimation 都能创建，句柄品牌带种类", () => {
    expect(services.createGeocoder().raw).toBeTruthy();
    expect(services.createConvertor().raw).toBeTruthy();
    expect(services.createGeolocation().raw).toBeTruthy();
    expect(services.createLocalCity().raw).toBeTruthy();
    expect(services.createBoundary().raw).toBeTruthy();
    expect(services.createAutocomplete({ input: input() }).raw).toBeTruthy();
    const animation = services.createViewAnimation([
      { center: { lng: 116.4, lat: 39.9 }, zoom: 12, percentage: 0 },
      { center: { lng: 116.4, lat: 39.9 }, zoom: 16, percentage: 1 },
    ]);
    expect(animation.raw).toBeTruthy();

    expect(registry.lookup(fake.createdGeocoders[0])).toBeTruthy();
    expect(fake.createdConvertors).toHaveLength(1);
    expect(fake.createdGeolocations).toHaveLength(1);
    expect(fake.createdLocalCities).toHaveLength(1);
    expect(fake.createdBoundaries).toHaveLength(1);
    expect(fake.createdAutocompletes).toHaveLength(1);
  });

  it("ViewAnimation 把领域 center 换成 raw Point，并保留 interation 约定", () => {
    const handle = services.createViewAnimation(
      [{ center: { lng: 116.4, lat: 39.9 }, zoom: 12, percentage: 0 }],
      { duration: 500, loop: 3 },
    );
    const raw = handle.raw as {
      keyFrames: Array<{ center?: unknown }>;
      options: Record<string, unknown>;
    };

    // 领域 Point → SDK Point 构造器（几何转换的事实由 instanceof 断言，而不是「看起来像」）
    expect(raw.keyFrames[0].center).toBeInstanceOf(fake.namespace.Point);
    expect(raw.options).toEqual({ duration: 500, delay: 0, interation: 3 });
  });

  it("TrackAnimation 按 Catalog 的 unsupported 显式失败，并指向 TrackLine", () => {
    const map = registry.adopt("map", new fake.namespace.Map(document.createElement("div")));
    expect(() => services.createTrackAnimation(map, [{ lng: 116.4, lat: 39.9 }])).toThrowError(
      expect.objectContaining({
        code: "BMAP_CAPABILITY_UNSUPPORTED",
        message: expect.stringContaining("TrackLine"),
      }),
    );
    expect(CAPABILITY_CATALOG["service.track-animation"].status).toBe("unsupported");
  });

  it("能力缺失时：throw 策略在构造前失败，warn 策略落到构造器缺失的统一错误", () => {
    const namespace = fake.namespace as unknown as Record<string, unknown>;
    const original = namespace.Geocoder;
    delete namespace.Geocoder;
    try {
      expect(() => services.createGeocoder()).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
      const lenient = buildDriver("warn");
      expect(() => lenient.createGeocoder()).toThrowError(
        expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
      );
    } finally {
      namespace.Geocoder = original;
    }
  });

  it("拒绝其它 Client 的句柄", () => {
    const other = createJsapiV4ServiceDriver({
      rawSdk: fake.namespace,
      geometry: createJsapiV4GeometryDriver(fake.namespace),
      capabilities,
      registry: createJsapiV4HandleRegistry(),
      events: createJsapiV4EventDriver({
        registry: createJsapiV4HandleRegistry(),
        geometry: createJsapiV4GeometryDriver(fake.namespace),
      }),
    });
    const foreign = other.createGeocoder();
    expect(() => services.geocode(foreign, { address: "北京市海淀区中关村" })).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

describe("v4 Service Facet：Geocoder（正/逆地址解析）", () => {
  it("成功：回包坐标归一为领域 Point", async () => {
    const handle = services.createGeocoder();
    const result = await services.geocode(handle, { address: "北京市海淀区中关村" }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual({ lng: 116.404, lat: 39.915 });
    expect(fake.createdGeocoders[0].callLog).toEqual(["getPoint:北京市海淀区中关村:"]);
  });

  it("空结果：SDK 回 null 且没有服务端错误码", async () => {
    const handle = services.createGeocoder();
    fake.createdGeocoders[0].pointResult = null;

    const result = await services.geocode(handle, { address: "查无此地" }).result;
    expect(result.status).toBe("empty");
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  it("失败只表现为 empty：官方没有公开错误码入口，本库不编造精确错误码（R25-C / #72）", async () => {
    const handle = services.createGeocoder();
    fake.createdGeocoders[0].pointResult = null;

    const result = await services.geocode(handle, { address: "北京市海淀区中关村" }).result;
    // 空结果与「服务当前不可用」在公开面上不可区分 → 一律 empty，而不是 failed + 猜出来的码
    expect(result.status).toBe("empty");
    expect(result.error).toBeNull();
    expect(result.sdkStatus).toBeNull();
    // 请求确实发出去了（不是被前置校验挡下），所以这条断言不是「没跑」的空转
    expect(fake.createdGeocoders[0].callLog).toEqual(["getPoint:北京市海淀区中关村:"]);
  });

  it("参数非法：不抛错，以 BMAP_INVALID_ARGUMENT 结算", async () => {
    const handle = services.createGeocoder();
    const result = await services.geocode(handle, { address: "" }).result;

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(fake.createdGeocoders[0].callLog).toHaveLength(0);
  });

  it("迟到回调：取消之后回包不改结果", async () => {
    const handle = services.createGeocoder();
    const geocoder = fake.createdGeocoders[0];
    geocoder.queue.auto = false;

    const call = services.geocode(handle, { address: "北京市海淀区中关村" });
    call.cancel();
    expect(geocoder.queue.flush()).toBe(1);

    const result = await call.result;
    expect(result.status).toBe("canceled");
    expect(result.data).toBeNull();
  });

  it("超时：SDK 不回包时给出 timeout，随后的迟到回包被忽略", async () => {
    vi.useFakeTimers();
    const handle = services.createGeocoder();
    const geocoder = fake.createdGeocoders[0];
    geocoder.queue.auto = false;

    const call = services.geocode(handle, { address: "北京市海淀区中关村" });
    vi.advanceTimersByTime(15000);
    expect((await call.result).status).toBe("timeout");

    geocoder.queue.flush();
    expect((await call.result).status).toBe("timeout");
  });

  it("逆地址解析：地址、商圈、结构化地址与附近 POI（含结构，不只是计数）", async () => {
    const handle = services.createGeocoder();
    const result = await services.reverseGeocode(handle, {
      point: { lng: 116.404, lat: 39.915 },
      numPois: 5,
    }).result;

    expect(result.status).toBe("success");
    const address = result.data as GeocodedAddress;
    expect(address).toMatchObject({
      address: "北京市东城区天安门",
      point: { lng: 116.404, lat: 39.915 },
      business: "天安门",
      poiCount: 2,
    });
    // `addressComponents` 与 `surroundingPois` 是官方 `GeocoderResult` 声明的字段：
    // #38 之前它们被静默丢弃（只留一个 poiCount），这里逐项钉住。
    expect(address.addressComponents).toEqual({
      province: null,
      city: null,
      district: null,
      street: null,
      streetNumber: null,
    });
    expect(address.surroundingPois.map((poi) => poi.title)).toEqual(["a", "b"]);
    // `marker` 是 SDK 的覆盖物对象：DTO 刻意不带 raw
    expect(address.surroundingPois[0]).not.toHaveProperty("marker");

    // 结构化地址真的按字段读进来了（不是恒 null）
    fake.createdGeocoders[0]!.locationResult = {
      address: "北京市东城区天安门",
      point: { lng: 116.404, lat: 39.915 },
      addressComponents: {
        province: "北京市",
        city: "北京市",
        district: "东城区",
        street: "东长安街",
        streetNumber: "1号",
      },
    };
    const detailed = await services.reverseGeocode(handle, {
      point: { lng: 116.404, lat: 39.915 },
    }).result;
    expect((detailed.data as GeocodedAddress).addressComponents).toEqual({
      province: "北京市",
      city: "北京市",
      district: "东城区",
      street: "东长安街",
      streetNumber: "1号",
    });

    expect(fake.createdGeocoders[0].callLog[0]).toBe('getLocation:{"numPois":5}');
  });
});

describe("v4 Service Facet：Convertor / Boundary", () => {
  it("坐标转换成功：status 0 时给出坐标数组", async () => {
    const handle = services.createConvertor();
    const result = await services.convert(handle, {
      points: [{ lng: 116.3, lat: 39.9 }],
      from: 1,
      to: 5,
    }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual([{ lng: 116.404, lat: 39.915 }]);
    expect(result.sdkStatus).toBe(0);
    expect(fake.createdConvertors[0].callLog).toEqual(["translate:1:1->5"]);
  });

  it("坐标转换失败：status 非 0 走 failed 并带回状态码", async () => {
    const handle = services.createConvertor();
    const convertor = fake.createdConvertors[0];
    convertor.status = 1;
    convertor.points = null;
    convertor.message = "坐标超出范围";

    const result = await services.convert(handle, {
      points: [{ lng: 116.3, lat: 39.9 }],
      from: 1,
      to: 5,
    }).result;

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: 1, message: "坐标超出范围" });
    expect(result.sdkStatus).toBe(1);
  });

  it("坐标转换为空输入：参数校验失败，不触碰 SDK", async () => {
    const handle = services.createConvertor();
    const result = await services.convert(handle, { points: [], from: 1, to: 5 }).result;

    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(fake.createdConvertors[0].callLog).toHaveLength(0);
  });

  it("坐标转换：非法坐标走结果通道（failed + BMAP_INVALID_ARGUMENT），不绕过封装同步抛错", async () => {
    const handle = services.createConvertor();
    const cases: Array<Record<string, unknown>> = [
      { lng: Number.NaN, lat: 39.9 },
      { lng: Number.POSITIVE_INFINITY, lat: 39.9 },
      { lng: 116.4 },
    ];

    for (const bad of cases) {
      const request = {
        points: [bad] as unknown as [never],
        from: 1 as const,
        to: 5 as const,
      };
      // 「连 ServiceCall 都没返回」就是本用例要挡的形态：调用必须不抛错
      let call!: ReturnType<typeof services.convert>;
      expect(() => {
        call = services.convert(handle, request);
      }, `非法坐标 ${JSON.stringify(bad)} 同步抛错了`).not.toThrow();

      const result = await call.result;
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    }

    // 一次都不该落到 SDK
    expect(fake.createdConvertors[0].callLog).toHaveLength(0);
  });

  it("行政区边界：点串原样透传 + 解析成坐标环（两个公开视图都给）", async () => {
    const handle = services.createBoundary();
    const result = await services.queryBoundary(handle, { name: "北京市" }).result;

    expect(result.status).toBe("success");
    const data = result.data as BoundaryRings;
    // `raw` 是官方回包原文（`isBoundary` 形态的覆盖物直接吃它）
    expect(data.raw).toEqual(["116.30,39.90;116.31,39.91;116.30,39.90"]);
    // `rings` 是解析后的坐标环
    expect(data.rings).toEqual([
      [
        { lng: 116.3, lat: 39.9 },
        { lng: 116.31, lat: 39.91 },
        { lng: 116.3, lat: 39.9 },
      ],
    ]);
  });

  it("行政区边界：空数组与 null 回包都是 empty（没有公开错误码入口）", async () => {
    const handle = services.createBoundary();
    const boundary = fake.createdBoundaries[0];

    boundary.boundaries = [];
    expect((await services.queryBoundary(handle, { name: "北京市" }).result).status).toBe("empty");

    boundary.boundaries = null;
    const unavailable = await services.queryBoundary(handle, { name: "北京市" }).result;
    expect(unavailable.status).toBe("empty");
    expect(unavailable.error).toBeNull();
  });
});

describe("v4 Service Facet：Geolocation / LocalCity", () => {
  it("定位成功：sdkStatus 与精度、地址一起归一", async () => {
    const handle = services.createGeolocation();
    const result = await services.locate(handle, { enableHighAccuracy: true }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      point: { lng: 116.404, lat: 39.915 },
      accuracy: 30,
      address: { city: "北京市", district: "东城区" },
    });
    expect(result.sdkStatus).toBe(0);
    expect(fake.createdGeolocations[0].callLog[1]).toBe(
      'getCurrentPosition:{"enableHighAccuracy":true}',
    );
  });

  it("定位失败：getStatus 的 BMAP_STATUS_* 变成可读原因", async () => {
    const handle = services.createGeolocation();
    const geolocation = fake.createdGeolocations[0];
    geolocation.status = 6;
    geolocation.result = null;

    const result = await services.locate(handle).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(6);
    expect(result.error?.message).toContain("定位权限被拒绝");
    expect(result.sdkStatus).toBe(6);
  });

  it("IP 定位：城市名 + 中心点；无城市名时是 empty", async () => {
    const handle = services.createLocalCity();
    expect((await services.locateCity(handle).result).data).toEqual({
      name: "北京市",
      center: { lng: 116.404, lat: 39.915 },
      level: 12,
    });

    fake.createdLocalCities[0].result = { name: "" };
    expect((await services.locateCity(handle).result).status).toBe("empty");
  });

  it("IP 定位：无城市名或 null 回包都是 empty（不把「不可用」猜成 failed）", async () => {
    const handle = services.createLocalCity();

    fake.createdLocalCities[0].result = { name: "" };
    expect((await services.locateCity(handle).result).status).toBe("empty");

    fake.createdLocalCities[0].result = null;
    const unavailable = await services.locateCity(handle).result;
    expect(unavailable.status).toBe("empty");
    expect(unavailable.error).toBeNull();
  });
});

describe("v4 Service Facet：Autocomplete（事件式服务的归一化）", () => {
  it("成功：search 后由内部监听结算，并转发业务自己的 onSearchComplete", async () => {
    const onSearchComplete = vi.fn();
    const handle = services.createAutocomplete({ input: input(), onSearchComplete });
    fake.createdAutocompletes[0].pois = [
      { business: "天安门", province: "北京市", district: "东城区" },
      { province: "北京市", city: "北京市", street: "中关村大街" },
    ];

    const result = await services.suggest(handle, "天安门").result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual([
      { title: "天安门", address: "北京市东城区", index: 0 },
      { title: "北京市北京市中关村大街", address: "北京市北京市中关村大街", index: 1 },
    ]);
    // 业务监听没有被内部发生器吞掉
    expect(onSearchComplete).toHaveBeenCalledTimes(1);
    expect(fake.createdAutocompletes[0].callLog).toContain("search:天安门");
  });

  it("空结果：回包但没有任何条目", async () => {
    const handle = services.createAutocomplete({ input: input() });
    fake.createdAutocompletes[0].pois = [];

    const result = await services.suggest(handle, "不存在的关键字").result;
    expect(result.status).toBe("empty");
    expect(result.data).toBeNull();
  });

  it("取消之后到达的回包仍然转给业务监听，但不复活本次调用", async () => {
    const onSearchComplete = vi.fn();
    const handle = services.createAutocomplete({ input: input(), onSearchComplete });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    const call = services.suggest(handle, "天安门");
    call.cancel();
    autocomplete.queue.flush();

    expect((await call.result).status).toBe("canceled");
    expect(onSearchComplete).toHaveBeenCalledTimes(1);
  });
});

describe("v4 Service Facet：Autocomplete 选项更新（R25-C / #72：raw setter 回到集成边界）", () => {
  it("setAutocompleteOptions 落到官方 setLocation / setTypes", () => {
    const handle = services.createAutocomplete({ input: input() });
    const raw = fake.createdAutocompletes[0];

    services.setAutocompleteOptions(handle, { location: "上海市", types: ["city"] });

    expect(raw.callLog).toContain("setLocation:上海市");
    expect(raw.callLog).toContain("setTypes:city");
    expect(raw.options.types).toEqual(["city"]);
  });

  it("location 归一化：领域 Point → raw Point；MapHandle → raw Map（不把句柄透传给 SDK）", () => {
    const map = registry.adopt(
      "map",
      new fake.namespace.Map(document.createElement("div")),
    );
    const handle = services.createAutocomplete({ input: input() });
    const raw = fake.createdAutocompletes[0];

    services.setAutocompleteOptions(handle, { location: { lng: 116.4, lat: 39.9 } });
    expect(raw.options.location).toBeInstanceOf(fake.namespace.Point);

    services.setAutocompleteOptions(handle, { location: map });
    // 官方 `AutocompleteOptions.location` 要的是 `Map | Point | string`：透传本库句柄是非法值
    expect(raw.options.location).toBe(map.raw);
  });

  it("构造期的 location 走同一份归一化（MapHandle 同样解析成 raw Map）", () => {
    const map = registry.adopt(
      "map",
      new fake.namespace.Map(document.createElement("div")),
    );
    services.createAutocomplete({ input: input(), location: map });

    expect(fake.createdAutocompletes[0].options.location).toBe(map.raw);
  });

  it("只接受 Autocomplete 句柄：别的服务句柄在运行期被拦下（与 dispose 共用一份判据）", () => {
    const geocoder = services.createGeocoder();

    expect(() =>
      // @ts-expect-error 专用入口只接受 Autocomplete 句柄（类型契约；此处验证运行期兜底）
      services.setAutocompleteOptions(geocoder, { types: ["city"] }),
    ).toThrowError(expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }));
  });

  it("已被 disposeAutocomplete() 释放的实例拒绝写入（不是静默成功）", () => {
    const handle = services.createAutocomplete({ input: input() });
    services.disposeAutocomplete(handle);

    expect(() => services.setAutocompleteOptions(handle, { types: ["city"] })).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT", message: expect.stringContaining("已") }),
    );
  });

  it("失去回调通道独占不影响纯配置写入（它不发起请求，也就没有归属问题）", async () => {
    const el = typableInput();
    const handle = services.createAutocomplete({ input: el });
    const raw = fake.createdAutocompletes[0];

    // 先让实例失去独占：可输入输入框上的 suggest() 会被拒绝并打上永久标记
    expect((await services.suggest(handle, "K").result).status).toBe("failed");

    expect(() => services.setAutocompleteOptions(handle, { types: ["city"] })).not.toThrow();
    expect(raw.callLog).toContain("setTypes:city");
  });
});

describe("v4 Service Facet：Autocomplete 释放后不得再回写（R25-C 复审 P1-1）", () => {
  /** 只读输入框 + 取消独占的实例（与组件用法同形）。 */
  function autocompleteWith(options: Record<string, unknown> = {}) {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    return services.createAutocomplete({ input: el, ...options });
  }

  it("回调已排队 → dispose → 迟到回包：不再调用业务 onSearchComplete", async () => {
    const onSearchComplete = vi.fn();
    const handle = autocompleteWith({ onSearchComplete });
    const autocomplete = fake.createdAutocompletes[0]!;
    // 手动时序：「请求已发、回包未到」——真实 JSONP 的最短延迟也长于一个同步回合
    autocomplete.queue.auto = false;

    const call = services.suggest(handle, "K");
    services.disposeAutocomplete(handle);
    expect((await call.result).status, "在飞调用被显式失败").toBe("failed");

    // 回包此刻才到达：实例已释放，不得再向业务回调（组件侧就是 emit 到已卸载的组件）
    autocomplete.queue.flush();
    expect(onSearchComplete, "已释放的实例不得再向业务回调写回").not.toHaveBeenCalled();
  });

  it("SDK dispose() 内同步触发回调的重入路径同样不穿透", () => {
    const onSearchComplete = vi.fn();
    const handle = autocompleteWith({ onSearchComplete });
    const autocomplete = fake.createdAutocompletes[0]!;
    // 真实 SDK 的销毁流程可能同步回调（本仓库的 Map / Panorama 都已按「可能重入」防护）
    autocomplete.onDispose = () => {
      const results = new FakeV4AutocompleteResult([{ business: "X", province: "北京市" }], "K");
      (autocomplete.options.onSearchComplete as (r: unknown) => void)(results);
    };

    services.disposeAutocomplete(handle);
    expect(onSearchComplete).not.toHaveBeenCalled();
  });

  it("对照组：未释放的实例仍然把回包转给业务回调（守卫不能把正常路径一起关掉）", async () => {
    const onSearchComplete = vi.fn();
    const handle = autocompleteWith({ onSearchComplete });
    const autocomplete = fake.createdAutocompletes[0]!;
    autocomplete.queue.auto = false;

    const call = services.suggest(handle, "K");
    autocomplete.queue.flush();
    expect((await call.result).status).toBe("success");
    expect(onSearchComplete).toHaveBeenCalledTimes(1);
  });
});

describe("v4 Service Facet：Autocomplete 的回包归属（PR #63 复审 P2-1）", () => {
  it("可输入的输入框 ⇒ suggest() 被拒绝（回包通道与用户输入共享，无法区分）", async () => {
    const handle = services.createAutocomplete({ input: typableInput() });

    const result = await services.suggest(handle, "K").result;
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("无法区分");
    // 请求根本不该发出去
    expect(fake.createdAutocompletes[0].callLog).not.toContain("search:K");
  });

  it("readOnly 输入框 ⇒ 通道独占，suggest() 正常可用", async () => {
    const handle = services.createAutocomplete({ input: input() });

    const result = await services.suggest(handle, "天安门").result;
    expect(result.status).toBe("success");
    expect(fake.createdAutocompletes[0].callLog).toContain("search:天安门");
  });

  // 五轮复审 P2：独占判定不能只信构造时的状态——HTML 控件的可编辑性取决于**当前**的
  // disabled / readonly / type，构造之后随时可以变回可输入。
  const HIDDEN = (el: HTMLInputElement): void => {
    el.type = "hidden";
  };
  const DISABLED = (el: HTMLInputElement): void => {
    el.disabled = true;
  };
  const READONLY = (el: HTMLInputElement): void => {
    el.readOnly = true;
  };

  it.each([
    ["disabled 被取消", DISABLED, (el: HTMLInputElement) => (el.disabled = false)],
    ["readOnly 被取消", READONLY, (el: HTMLInputElement) => (el.readOnly = false)],
    ["type 从 hidden 改为 text", HIDDEN, (el: HTMLInputElement) => (el.type = "text")],
  ])("构造后输入框恢复可输入（%s）⇒ suggest() 必须拒绝", async (_name, makeExclusive, makeTypable) => {
    const el = document.createElement("input");
    makeExclusive(el);
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });

    makeTypable(el);

    const result = await services.suggest(handle, "K").result;
    expect(result.status).toBe("failed");
    expect(fake.createdAutocompletes[0].callLog).not.toContain("search:K");
  });

  it("等待回包期间输入框恢复可输入 ⇒ 该调用必须显式失败（不能接受可能来自用户输入的回包）", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");

    // 等待期间用户把输入框变回可输入，然后键入同关键词 → 原生检索的回包（TYPED）到达
    el.readOnly = false;
    autocomplete.pois = [{ business: "TYPED", province: "上海市" }];
    const raw = autocomplete as unknown as { search(keyword: string): void };
    raw.search("K");
    autocomplete.queue.flush();

    const result = await call.result;
    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });

  it("一旦观察到失去独占（可编辑期间已可能产生原生请求），即使又变回只读也不恢复资格", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });

    // 观察到失去独占：可编辑期间调用被拒绝（同时实例被永久标记）
    el.readOnly = false;
    expect((await services.suggest(handle, "K").result).status).toBe("failed");

    el.readOnly = true; // 又变回只读 —— 不能因此恢复
    const result = await services.suggest(handle, "K").result;
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("重建");
  });

  // 六轮复审 P2：只看「检查时」的当前状态发现不了检查间隔内的翻转——
  // 解除只读 → 用户输入发出原生检索 → 又恢复只读，两道检查看到的都是只读。
  // 七轮复审后判定改为**监听输入活动**（`input` 事件，官方文档里原生检索的触发源），
  // 因为「属性被写过」不等于「曾经可输入」（同值写入也会产生属性记录）。
  it("未观察到的翻转窗口（解除只读 → 用户输入 → 恢复只读）之后 suggest() 必须拒绝", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    el.readOnly = false; // 用户可输入——没有任何 Driver 检查在这个时刻运行
    el.dispatchEvent(new Event("input")); // 用户输入活动（原生检索的触发源）
    autocomplete.pois = [{ business: "TYPED", province: "北京市" }];
    (autocomplete as unknown as { search(keyword: string): void }).search("K"); // 原生检索已发出
    el.readOnly = true; // 恢复只读

    const call = services.suggest(handle, "K");
    autocomplete.queue.flush(); // 原生回包（TYPED）到达
    const result = await call.result;
    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });

  it("等待回包期间的未观察翻转窗口：程序化调用不得被原生回包结算", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");

    el.readOnly = false;
    el.dispatchEvent(new Event("input"));
    autocomplete.pois = [{ business: "TYPED", province: "上海市" }];
    (autocomplete as unknown as { search(keyword: string): void }).search("K");
    el.readOnly = true;

    autocomplete.queue.flush(); // 原生回包到达
    const result = await call.result;
    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });

  // 七轮复审 P2-2：`input.readOnly = true` 这类**同值写入**在真实 Chromium 里同样产生属性记录，
  // 把「属性被写过」当成「曾经可输入」会永久禁用完全安全的实例。
  it("反复写入同样的只读属性（始终没有可输入窗口）不得使实例失效", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");
    el.readOnly = true; // 同值写入
    el.readOnly = true;
    autocomplete.queue.flush();

    const result = await call.result;
    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("NEW");
  });

  it("始终只读、只随 loading 切换 disabled 时不得使实例失效", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    el.disabled = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    el.disabled = false; // loading 结束
    el.disabled = true; // 又进入 loading
    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");
    autocomplete.queue.flush();

    expect((await call.result).status).toBe("success");
  });

  it("始终 type=hidden、只切换 disabled 时不得使实例失效", async () => {
    const el = document.createElement("input");
    el.type = "hidden";
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    el.disabled = true;
    el.disabled = false;
    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");
    autocomplete.queue.flush();

    expect((await call.result).status).toBe("success");
  });

  // 七轮复审 P2-1：监听器必须随「正常销毁」释放，不能只在失去独占时释放。
  // 八轮复审 P2-1：入口收窄为 Autocomplete 专用（`disposeAutocomplete`），并在运行期校验句柄种类。
  it("disposeAutocomplete() 解绑输入活动监听（输入框留存、反复创建/销毁不累积）", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const removeSpy = vi.spyOn(el, "removeEventListener");

    const handles = [0, 1, 2].map(() => services.createAutocomplete({ input: el }));
    for (const handle of handles) services.disposeAutocomplete(handle);

    expect(removeSpy).toHaveBeenCalledTimes(3);
    expect(removeSpy.mock.calls.every(([type]) => type === "input")).toBe(true);
  });

  it("disposeAutocomplete() 幂等：释放后程序化检索被拒绝，在飞调用显式失败，SDK dispose 被调用", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");

    services.disposeAutocomplete(handle);
    expect((await call.result).status).toBe("failed");
    expect(() => services.disposeAutocomplete(handle)).not.toThrow(); // 幂等

    const after = await services.suggest(handle, "K2").result;
    expect(after.status).toBe("failed");
    expect(after.error?.message).toContain("dispose");
    expect(autocomplete.callLog).toContain("dispose");
  });

  it("别的服务句柄传进专用释放入口：类型上不允许，运行期也拦下来（不悄悄当成 Autocomplete）", () => {
    const geocoder = services.createGeocoder();

    expect(() =>
      // @ts-expect-error 专用入口只接受 Autocomplete 句柄（类型契约；此处验证运行期兜底）
      services.disposeAutocomplete(geocoder),
    ).toThrowError(expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }));
  });

  // 九轮复审 P2：订阅（EventListener / 分组）也是 Driver 侧资源——SDK 清空自己的监听器不会删除
  // EventDriver 的强引用分组，所以专用释放入口必须一并释放该目标的订阅（与 Map / Panorama 同源）。
  it("disposeAutocomplete() 释放 EventDriver 持有的订阅（分组归零，反复创建/释放不累积）", async () => {
    for (let round = 0; round < 3; round += 1) {
      const el = document.createElement("input");
      el.readOnly = true;
      document.body.appendChild(el);
      const handle = services.createAutocomplete({ input: el });
      const autocomplete = fake.createdAutocompletes[round]!;

      events.on(handle, "confirm", vi.fn());
      events.on(handle, "highlight", vi.fn());
      // 两个不同事件类型 ⇒ 两个 raw listener（同类型内的多个 handler 才共用一份）
      expect(autocomplete.getListenerCount()).toBe(2);

      services.disposeAutocomplete(handle);
      expect(autocomplete.getListenerCount(), `第 ${round + 1} 轮释放后订阅必须归零`).toBe(0);
    }
  });

  it("SDK 销毁钩子里重入 disposeAutocomplete()：不会真的销毁两次", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];

    autocomplete.onDispose = () => services.disposeAutocomplete(handle);
    services.disposeAutocomplete(handle);

    expect(autocomplete.callLog.filter((entry) => entry === "dispose")).toHaveLength(1);
  });

  // 八轮复审 P2-2：SDK 销毁抛错时，句柄必须保持「不再接受业务调用」，但**不能**因此
  // 让后续 dispose 直接短路——否则底层资源永远失去重试清理的入口。
  it("SDK dispose 抛错：句柄立即停用，且再次调用会重试未完成的 SDK 清理", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");

    autocomplete.failNextDispose = new TypeError("Cannot read properties of undefined");
    expect(() => services.disposeAutocomplete(handle)).toThrow();

    // ① 句柄已停用（新调用被拒绝）、② 在飞调用已被显式失败
    expect((await services.suggest(handle, "K3").result).status).toBe("failed");
    expect((await call.result).status).toBe("failed");

    // ③ 再次调用会重试 SDK 清理，并且这次成功
    expect(() => services.disposeAutocomplete(handle)).not.toThrow();
    expect(autocomplete.callLog.filter((entry) => entry === "dispose")).toHaveLength(2);
  });

  it("收到不属于任何程序化请求的回包（用户在输入框里打字）不会污染后续调用（也不消费槽位）", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    // 原生检索（不经 suggest 登记）的回包先到：它不属于任何程序化请求
    autocomplete.pois = [{ business: "TYPED", province: "北京市" }];
    (autocomplete as unknown as { search(keyword: string): void }).search("typed-by-user");
    autocomplete.queue.flush();

    // 后续程序化调用仍然各归其位（隔离性由「通道独占 + 关键字关联」保证）
    autocomplete.pois = [{ business: "NEW", province: "上海市" }];
    const call = services.suggest(handle, "K");
    autocomplete.queue.flush();
    const result = await call.result;
    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("NEW");
  });

  it("取消 A 之后 A 的迟到回包不得结算 B", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    a.cancel();

    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    // A 与 B 各回一次包，A 的先到（结果里带着 A 的条目 AAA）
    expect(autocomplete.queue.flush()).toBe(2);
    const result = await b.result;

    // 归属错了的表现就是「B 拿到了 A 的结果」：断言标题必须是 B 自己的 BBB
    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("BBB");
    expect((await a.result).status).toBe("canceled");
  });

  it("发起 A → 发起 B → 取消 A：B 仍由自己的回包结算，不因取消 A 被清空", async () => {
    vi.useFakeTimers();
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");
    a.cancel();

    expect(autocomplete.queue.flush()).toBe(2);
    vi.advanceTimersByTime(15000);
    const result = await b.result;

    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("BBB");
  });

  it("没有 pending suggest 的回包（用户在输入框里打字触发）不会误结算任何调用", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    // 直接 search（不入 pending 队列）后回包：不应抛错、也不应影响后续的 suggest
    const raw = autocomplete as unknown as { search(keyword: string): void };
    raw.search("typed-by-user");
    autocomplete.queue.flush();

    const call = services.suggest(handle, "天安门");
    autocomplete.queue.flush();
    expect((await call.result).status).toBe("success");
  });

  it("乱序回包（B 的先到）：按 keyword 关联，不串线", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    // 乱序：B 的回包先到（官方 `AutocompleteResult.keyword` 是唯一的请求关联依据）
    expect(autocomplete.queue.flushOne(1)).toBe(true);
    expect((await b.result).data?.[0]?.title).toBe("BBB");

    expect(autocomplete.queue.flushOne(0)).toBe(true);
    expect((await a.result).data?.[0]?.title).toBe("AAA");
  });

  it("回包不带 keyword 时退化为 FIFO（顺序到达仍然正确）", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;
    // 官方把 `keyword` 声明为可选，运行时不保证填充 → 这条路径必须仍然可用
    autocomplete.includeKeyword = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    autocomplete.queue.flush();
    expect((await a.result).data?.[0]?.title).toBe("AAA");
    expect((await b.result).data?.[0]?.title).toBe("BBB");
  });

  it("回包带 keyword 但与任何 pending 都不匹配时，不得结算 queue 里的下一个调用", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    // 先让一个 suggest 处于 pending（回包还没到）
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    // 用户在输入框里打字触发的搜索（不经过 suggest）：它的回包带自己的 keyword
    autocomplete.pois = [{ business: "TYPED", province: "北京市" }];
    const raw = autocomplete as unknown as { search(keyword: string): void };
    raw.search("typed-by-user");

    // 用户输入那次的回包先到（index 1）——它不属于任何 pending
    expect(autocomplete.queue.flushOne(1)).toBe(true);
    // B 自己的回包随后到达
    expect(autocomplete.queue.flushOne(0)).toBe(true);

    const result = await b.result;
    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("BBB");
  });

  // 二轮复审曾要求「同关键词重试必须由新回包结算」（当时用「取最新同名项」实现）。三轮复审用
  // **按请求顺序正常返回**的反例证明那条规则会把旧回包塞给新请求；而「取最早同名项」又会在
  // 旧回包始终不到达时让新请求饿死。两者都只是「按到达时间猜」，因为 `Autocomplete` 的回包
  // **不带请求身份**。因此契约改为：**同关键词的并发/重叠请求直接显式失败**——这样同一关键词
  // 在任意时刻最多只有一个槽位，回包归属与到达顺序无关（两种顺序都正确）。
  it("取消旧 K 后立刻重查同关键词：显式失败（回包无法区分），旧结果不得交给新请求", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const oldCall = services.suggest(handle, "K");
    oldCall.cancel();

    const retry = services.suggest(handle, "K");
    const result = await retry.result;
    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("无法区分");

    // 旧回包（按请求顺序先到）必须被它自己的槽位吸收，不能落到别处
    expect(autocomplete.queue.flush()).toBe(1);
    expect(autocomplete.queue.pending).toBe(0);
  });

  it("同关键词超时后立刻重查：同样显式失败（旧回包随时可能到达）", async () => {
    vi.useFakeTimers();
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const first = services.suggest(handle, "K");
    vi.advanceTimersByTime(15000);
    expect((await first.result).status).toBe("timeout");

    const retry = services.suggest(handle, "K");
    expect((await retry.result).status).toBe("failed");
  });

  it("同关键词两次并发：第二次被拒绝，两个调用的结果绝不互换", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K1", province: "北京市" }];
    const first = services.suggest(handle, "K");
    const second = services.suggest(handle, "K");

    expect((await second.result).status).toBe("failed");
    // 只有一个请求真的发出去了，因此它的回包只属于它自己
    expect(autocomplete.callLog.filter((entry) => entry.startsWith("search:"))).toEqual(["search:K"]);
    autocomplete.queue.flush();
    expect((await first.result).data?.[0]?.title).toBe("K1");
  });

  it("旧 K 的回包到达（槽位释放）之后，同关键词重查可以正常进行", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const oldCall = services.suggest(handle, "K");
    oldCall.cancel();
    autocomplete.queue.flush(); // 旧回包到达 → 槽位释放

    autocomplete.pois = [{ business: "K-NEW", province: "上海市" }];
    const retry = services.suggest(handle, "K");
    autocomplete.queue.flush();
    expect((await retry.result).data?.[0]?.title).toBe("K-NEW");
  });

  it("不同关键词的取消 + 重查不受限制（最常见用法仍然可用，且两种到达顺序都正确）", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "A-OLD", province: "北京市" }];
    const first = services.suggest(handle, "A");
    first.cancel();
    autocomplete.pois = [{ business: "B", province: "上海市" }];
    const second = services.suggest(handle, "B");

    // 乱序到达：B 的回包先到
    expect(autocomplete.queue.flushOne(1)).toBe(true);
    expect((await second.result).data?.[0]?.title).toBe("B");
    expect(autocomplete.queue.flushOne(0)).toBe(true);
    expect((await first.result).status).toBe("canceled");
  });

  it("待回包队列达到上限时拒绝新调用（不淘汰旧记录），同关键词保护因此不会失效", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    // 旧 K 取消，回包仍在飞
    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const oldK = services.suggest(handle, "K");
    oldK.cancel();

    // 再发起并取消 16 个不同关键词，把待回包记录顶到上限
    for (let index = 0; index < 16; index += 1) {
      autocomplete.pois = [{ business: `N${index}`, province: "北京市" }];
      services.suggest(handle, `N${index}`).cancel();
    }

    // 旧 K 的回包仍在飞：此时再次请求 K 必须被拒绝（淘汰记录会让它被误判为「不存在」）
    autocomplete.pois = [{ business: "K-NEW", province: "上海市" }];
    const retry = services.suggest(handle, "K");
    const result = await retry.result;

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();

    // 旧回包到达后只能被它自己的记录吸收，不会落到任何别的调用上
    autocomplete.queue.flush();
    expect(result.data).toBeNull();
  });

  it("待回包队列达到上限：第 17 次调用被拒绝，已登记的请求仍各归其位", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    const calls: Array<ReturnType<typeof services.suggest>> = [];
    for (let index = 0; index < 16; index += 1) {
      autocomplete.pois = [{ business: `N${index}`, province: "北京市" }];
      calls.push(services.suggest(handle, `K${index}`));
    }

    autocomplete.pois = [{ business: "N16", province: "北京市" }];
    const overflow = services.suggest(handle, "K16");
    expect((await overflow.result).status).toBe("failed");

    autocomplete.queue.flush();
    // 16 个已登记的请求各自拿到自己的回包（没有淘汰、也没有错位）
    expect((await calls[0]!.result).data?.[0]?.title).toBe("N0");
    expect((await calls[15]!.result).data?.[0]?.title).toBe("N15");
  });
});


describe("v4 Service Facet：LocalSearch（M7-SERVICE-CORE / #38）", () => {
  /** 纯 headless 实例：不传 renderOptions，因此不会在任何地图上绘制覆盖物。 */
  function localSearchWith(location: unknown = "北京市", options?: Record<string, unknown>) {
    return services.createLocalSearch(location, options);
  }

  /** 落到 SDK 的**检索调用**（不含构造期记录）。 */
  function searchCalls(): string[] {
    return fake.createdLocalSearches[0]!.callLog.filter((entry) => !entry.startsWith("construct:"));
  }

  it("search：回包归一成领域结果（关键字 / pois / 分页读数 / 建议 / 更多链接）", async () => {
    const handle = localSearchWith();

    const result = await services.search(handle, "天安门").result;

    expect(result.status).toBe("success");
    const [page] = result.data as LocalSearchResult[];
    expect(page.keyword).toBe("天安门");
    expect(page.city).toBe("北京市");
    expect(page.pois.map((poi) => poi.title)).toEqual(["天安门", "故宫博物院"]);
    expect(page.pois[0]?.address).toBe("北京市东城区东长安街");
    // 分页读数是 getCurrentNumPois / getNumPois / getNumPages / getPageIndex 的投影
    expect(page.pageSize).toBe(2);
    expect(page.total).toBe(2);
    expect(page.pageCount).toBe(1);
    expect(page.pageIndex).toBe(0);
    expect(page.suggestions).toEqual(["天安门 的结果建议"]);
    expect(page.moreResultsUrl).toBe("https://map.baidu.com/search/天安门");
    // 状态码来自公开的 getStatus()（0 = BMAP_STATUS_SUCCESS）
    expect(result.sdkStatus).toBe(0);
  });

  it("search：多关键字回包归一成数组，顺序与关键字一致", async () => {
    const handle = localSearchWith();

    const result = await services.search(handle, ["咖啡", "甜品"]).result;

    expect(result.status).toBe("success");
    expect((result.data as LocalSearchResult[]).map((item) => item.keyword)).toEqual([
      "咖啡",
      "甜品",
    ]);
  });

  it("searchInBounds：领域矩形经 GeometryDriver 转成 raw Bounds，范围字段进结果", async () => {
    const handle = localSearchWith();
    const bounds = { southwest: { lng: 116.2, lat: 39.8 }, northeast: { lng: 116.6, lat: 40.0 } };

    const result = await services.searchInBounds(handle, { keyword: "超市", bounds }).result;

    expect(result.status).toBe("success");
    expect((result.data as LocalSearchResult[])[0]?.bounds).toEqual(bounds);
    // 传给 SDK 的是 raw Bounds（有 getSouthWest / getNorthEast），不是裸对象
    const raw = fake.createdLocalSearches[0]!;
    expect(raw.callLog.some((entry) => entry.startsWith("searchInBounds:超市:"))).toBe(true);
  });

  it("searchInBounds：非法 bounds 走结果通道（failed），不从调用之外抛错", async () => {
    const handle = localSearchWith();

    const result = await services.searchInBounds(handle, {
      keyword: "超市",
      bounds: { southwest: { lng: Number.NaN, lat: 39.8 }, northeast: { lng: 116.6, lat: 40 } },
    }).result;

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
  });

  it("searchNearby：领域 Point 转 raw Point，半径透传；城市名亦可", async () => {
    const handle = localSearchWith();

    const nearby = await services.searchNearby(handle, {
      keyword: "银行",
      center: { lng: 116.404, lat: 39.915 },
      radius: 2000,
    }).result;
    expect(nearby.status).toBe("success");
    expect(fake.createdLocalSearches[0]!.callLog).toContain("searchNearby:银行:[object Object]:2000");

    const byCity = await services.searchNearby(handle, {
      keyword: "医院",
      center: "上海市",
      radius: 1000,
    }).result;
    expect(byCity.status).toBe("success");
    expect(fake.createdLocalSearches[0]!.callLog).toContain("searchNearby:医院:上海市:1000");
  });

  it("searchNearby：缺分量 / 非有限坐标 / 缺半径都以 failed 结算，且不落到 SDK", async () => {
    const handle = localSearchWith();

    const badPoint = await services.searchNearby(handle, {
      keyword: "银行",
      center: { lng: Number.NaN, lat: 39.915 },
      radius: 2000,
    }).result;
    expect(badPoint.status).toBe("failed");
    expect(badPoint.error?.code).toBe("BMAP_INVALID_ARGUMENT");

    const badRadius = await services.searchNearby(handle, {
      keyword: "银行",
      center: { lng: 116.404, lat: 39.915 },
      radius: -1,
    }).result;
    expect(badRadius.status).toBe("failed");

    // 一次检索都没有落到 SDK（construct 是构造期记的，不属于调用）
    expect(searchCalls()).toHaveLength(0);
  });

  it("gotoPage：合法页码翻页（页码进结果），非法页码给出官方状态码 5", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    // 12 条结果 + 每页 10 条 ⇒ 共 2 页
    raw.pois = Array.from({ length: 12 }, (_, index) => ({ title: `POI-${index}` }));
    raw.options.pageCapacity = 10;

    const first = await services.search(handle, "餐厅").result;
    expect((first.data as LocalSearchResult[])[0]?.pageCount).toBe(2);
    expect((first.data as LocalSearchResult[])[0]?.pageSize).toBe(10);

    const second = await services.gotoPage(handle, 1).result;
    expect(second.status).toBe("success");
    const page = (second.data as LocalSearchResult[])[0];
    expect(page.pageIndex).toBe(1);
    // 第 2 页只有剩下的 2 条
    expect(page.pageSize).toBe(2);
    expect(page.pois.map((poi) => poi.title)).toEqual(["POI-10", "POI-11"]);

    const invalid = await services.gotoPage(handle, 9).result;
    expect(invalid.status).toBe("failed");
    // 官方公开状态码：INVALID_REQUEST = 5（不编造、不改写）
    expect(invalid.error?.code).toBe(5);
    expect(invalid.sdkStatus).toBe(5);
  });

  it("gotoPage：页码不是非负整数时以 BMAP_INVALID_ARGUMENT 拒绝，不落到 SDK", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;

    for (const page of [-1, 1.5, Number.NaN]) {
      const result = await services.gotoPage(handle, page).result;
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    }
    expect(raw.callLog.filter((entry) => entry.startsWith("gotoPage:"))).toHaveLength(0);
  });

  it("查无结果：回包是合法 LocalResult 但 0 条 ⇒ success + 空 pois（与 empty 区分）", async () => {
    const handle = localSearchWith();
    fake.createdLocalSearches[0]!.pois = [];

    const result = await services.search(handle, "不存在的店").result;

    expect(result.status).toBe("success");
    const [page] = result.data as LocalSearchResult[];
    expect(page.pois).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.pageCount).toBe(0);
  });

  it("服务不可用（回包为 null）且状态码非 0：按公开状态码 failed，不编造原因", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.overridePayload = null;
    raw.status = 7; // BMAP_STATUS_SERVICE_UNAVAILABLE

    const result = await services.search(handle, "餐厅").result;

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(7);
    expect(result.error?.message).toContain("服务不可用");
    expect(result.sdkStatus).toBe(7);
  });

  it("回包为 null 但状态码是 0/1：归成 empty（没有公开原因就不假装是失败）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.overridePayload = null;
    raw.status = 0;

    const result = await services.search(handle, "餐厅").result;

    expect(result.status).toBe("empty");
    expect(result.error).toBeNull();
  });

  it("超时：给出 timeout；迟到回包由墓碑吸收，同关键词重查仍然可用", async () => {
    vi.useFakeTimers();
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    // 手动时序：**回包真的排进了队列**（`respond = false` 那种「压根没回包」的写法
    // 会让下面的断言恒真——门禁空转）
    raw.queue.auto = false;

    const call = services.search(handle, "餐厅");
    vi.advanceTimersByTime(15000);
    expect((await call.result).status).toBe("timeout");
    // 正证守卫：确实有一个迟到回包在飞
    expect(raw.queue.pending, "迟到回包必须真的在队列里").toBe(1);

    // 关键时序：**在迟到回包到达之前**重查同一个关键词。超时把槽位降级成了墓碑，
    // 因此互斥规则不再挡它（若没降级，这里会以 failed(BMAP_SERVICE_FAILED) 被拒绝）。
    const retried = services.search(handle, "餐厅");
    expect(
      raw.callLog.filter((entry) => entry.startsWith("search:餐厅")),
      "重查必须真的落到 SDK（正证）",
    ).toHaveLength(2);
    // 两个槽位：墓碑 + 新请求
    expect(raw.queue.pending).toBe(2);

    // 迟到回包先到：被墓碑吸收（不复活已超时的调用），新请求的回包随后结算自己
    expect(raw.queue.flush()).toBe(2);
    expect((await call.result).status, "迟到回包不得复活已超时的调用").toBe("timeout");
    const settled = await retried.result;
    expect(settled.status).toBe("success");
    expect((settled.data as LocalSearchResult[])[0]?.keyword).toBe("餐厅");

    services.disposeLocalSearch(handle);
    vi.useRealTimers();
  });

  it("空关键字 / 非法关键字数组：BMAP_INVALID_ARGUMENT，一次都不落到 SDK", async () => {
    const handle = localSearchWith();

    for (const keyword of ["", [], ["ok", ""]]) {
      const result = await services.search(handle, keyword as never).result;
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    }
    expect(searchCalls()).toHaveLength(0);
  });

  it("句柄守卫：非 LocalSearch 句柄同步抛 BMAP_INVALID_ARGUMENT，外来句柄抛 BMAP_HANDLE_FOREIGN", async () => {
    const autocomplete = services.createAutocomplete({ input: input() });
    expect(() => services.search(autocomplete as never, "餐厅")).toThrowError(/只接受 createLocalSearch/);

    const foreign = createJsapiV4HandleRegistry();
    const foreignHandle = foreign.adopt("service:local-search", {});
    expect(() => services.search(foreignHandle as never, "餐厅")).toThrowError(/不属于当前 Client/);
  });

  it("clearLocalSearch：调用 SDK 的 clearResults；已释放实例上拒绝写入", () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;

    services.clearLocalSearch(handle);
    expect(raw.callLog).toContain("clearResults");

    services.disposeLocalSearch(handle);
    expect(() => services.clearLocalSearch(handle)).toThrowError(/已被 disposeLocalSearch\(\) 释放/);
  });

  it("取消 A 之后立刻重查 A：允许（墓碑不参与互斥），且 A 的迟到回包不得交给新请求", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    raw.pois = [{ title: "OLD" }];
    const first = services.search(handle, "A");
    first.cancel();

    raw.pois = [{ title: "NEW" }];
    const second = services.search(handle, "A");
    // 两个槽位：墓碑（已取消的第一次）+ 新的这一次
    expect(raw.queue.pending).toBe(2);

    expect(raw.queue.flush()).toBe(2);
    expect((await first.result).status).toBe("canceled");
    const retried = await second.result;
    expect(retried.status).toBe("success");
    expect((retried.data as LocalSearchResult[])[0]?.pois[0]?.title).toBe("NEW");
  });

  it("取消 A 之后发起 B：A 的迟到回包被墓碑吸收，不会结算给 B", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    raw.pois = [{ title: "A-OLD" }];
    const a = services.search(handle, "A");
    a.cancel();

    raw.pois = [{ title: "B-NEW" }];
    const b = services.search(handle, "B");

    // 先只让 A 的回包到达
    expect(raw.queue.flushOne(0)).toBe(true);
    expect((await Promise.resolve(), (await a.result).status)).toBe("canceled");

    expect(raw.queue.flush()).toBe(1);
    const settled = await b.result;
    expect(settled.status).toBe("success");
    expect((settled.data as LocalSearchResult[])[0]?.keyword).toBe("B");
    expect((settled.data as LocalSearchResult[])[0]?.pois[0]?.title).toBe("B-NEW");
  });

  it("同关键字的两个未结算检索：第二次显式失败（回包无法区分）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const first = services.search(handle, "K");
    const second = services.search(handle, "K");

    expect((await second.result).status).toBe("failed");
    expect((await second.result).error?.code).toBe("BMAP_SERVICE_FAILED");
    // 只有第一次真的发出去了
    expect(raw.callLog.filter((entry) => entry.startsWith("search:K"))).toHaveLength(1);

    raw.queue.flush();
    expect((await first.result).status).toBe("success");
  });

  it("回包带 keyword 但与队首期望不符时：不消费槽位（真正的回包仍能对上）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const call = services.search(handle, "A");
    // 伪造一个不属于本次请求的回包（keyword 不同），直接经构造选项回调投递
    const foreign = new FakeV4LocalResult({ keyword: "Z", pois: [] });
    (raw.options.onSearchComplete as (value: unknown) => void)(foreign);

    // 槽位仍在：真正的回包到达时才结算
    expect(raw.queue.pending).toBe(1);
    raw.queue.flush();
    const result = await call.result;
    expect(result.status).toBe("success");
    expect((result.data as LocalSearchResult[])[0]?.keyword).toBe("A");
  });

  it("待回包队列达到上限时拒绝新调用（不淘汰旧记录）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const calls = Array.from({ length: 16 }, (_, index) => services.search(handle, `K${index}`));
    const overflow = services.search(handle, "K-overflow");

    expect((await overflow.result).status).toBe("failed");
    expect((await overflow.result).error?.message).toContain("已达上限 16");

    raw.queue.flush();
    for (const call of calls) {
      expect((await call.result).status).toBe("success");
    }
  });

  it("disposeLocalSearch：在飞调用显式失败、释放后拒绝新调用、重复调用幂等", async () => {
    vi.useFakeTimers();
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const inflight = services.search(handle, "餐厅");
    services.disposeLocalSearch(handle);
    expect((await inflight.result).status).toBe("failed");

    expect((await services.search(handle, "餐厅").result).status).toBe("failed");
    expect(raw.callLog.filter((entry) => entry === "dispose")).toHaveLength(1);

    services.disposeLocalSearch(handle);
    expect(raw.callLog.filter((entry) => entry === "dispose")).toHaveLength(1);
  });

  it("disposeLocalSearch：SDK dispose 抛错时不记账，下一次重试；泄漏账头保留", () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.failNextDispose = new Error("destroy boom");

    expect(() => services.disposeLocalSearch(handle)).toThrowError(/LocalSearch.dispose/);
    expect(fake.diagnostics.snapshot().leaks.localSearches).toBe(1);

    services.disposeLocalSearch(handle);
    expect(fake.diagnostics.snapshot().leaks.localSearches).toBe(0);
  });

  it("disposeLocalSearch：销毁钩子里重入 dispose 不会重复销毁 SDK 实例", () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.onDispose = () => services.disposeLocalSearch(handle);

    services.disposeLocalSearch(handle);

    expect(raw.callLog.filter((entry) => entry === "dispose")).toHaveLength(1);
    expect(fake.diagnostics.snapshot().leaks.localSearches).toBe(0);
  });

  it("创建面：renderOptions.map 必须是本库的 MapHandle（绘制所有权可验证）", () => {
    expect(() => services.createLocalSearch("北京市", { renderOptions: { map: {} } })).toThrowError(
      /renderOptions\.map 必须是本库的 MapHandle/,
    );
    // 只有官方声明的绘制字段会被透传（构造选项里另有 Driver 自己挂的内部分发器）
    const handle = services.createLocalSearch("北京市", {
      renderOptions: { autoViewport: true, selectFirstResult: false },
      pageCapacity: 5,
      pageNum: 1,
    });
    const options = fake.createdLocalSearches[0]!.options;
    expect(options.renderOptions).toEqual({ autoViewport: true, selectFirstResult: false });
    expect(options.pageCapacity).toBe(5);
    expect(options.pageNum).toBe(1);
    expect(options.onSearchComplete).toBeTypeOf("function");
    services.disposeLocalSearch(handle);
  });

  it("创建面：检索区域必须是城市名 / 领域 Point / MapHandle", () => {
    expect(() => services.createLocalSearch(42)).toThrowError(/检索区域必须是城市名字符串/);
    expect(() => services.createLocalSearch("")).toThrowError(/不能是空字符串/);

    const point = services.createLocalSearch({ lng: 116.404, lat: 39.915 });
    expect(fake.createdLocalSearches[0]!.location).toMatchObject({ lng: 116.404, lat: 39.915 });
    services.disposeLocalSearch(point);
  });
});
