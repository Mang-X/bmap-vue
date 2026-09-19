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
  LocalSearchOptions,
  LocalSearchResult,
} from "../types/services";
import type { Point } from "../types/geometry";

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
 * 联想输入框：真实 4.0 要求它挂在文档上，本库只负责把 SDK 的回包转给调用方。
 *
 * 有没有 `readOnly` 已经无关紧要——程序化检索（原 `suggest()`）连同它的「回调通道独占」判定
 * 一起按 #104 删除了，本库不再猜任何回包属于哪一次请求。
 */
function input(): HTMLInputElement {
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

describe("v4 Service Facet：Autocomplete（事件式服务：只转发，不做归属推断）", () => {
  /**
   * 由 **SDK 侧**触发一次检索并立刻结算回调队列——真实场景就是用户在输入框里打字。
   * 本库不参与发起，因此这是唯一能观察「转发」这条路径的写法。
   */
  function fireNativeSearch(keyword: string) {
    const autocomplete = fake.createdAutocompletes[0]!;
    autocomplete.queue.auto = false;
    autocomplete.search(keyword);
    autocomplete.queue.flush();
    return autocomplete;
  }

  it("回包原样转发给调用方的 onSearchComplete：本库不解读结果、也不猜它属于哪次请求", () => {
    const onSearchComplete = vi.fn();
    services.createAutocomplete({ input: input(), onSearchComplete });
    fake.createdAutocompletes[0]!.pois = [
      { business: "天安门", province: "北京市", district: "东城区" },
    ];

    fireNativeSearch("天安门");

    expect(onSearchComplete).toHaveBeenCalledTimes(1);
    const [results] = onSearchComplete.mock.lastCall as [FakeV4AutocompleteResult];
    expect(results).toBeInstanceOf(FakeV4AutocompleteResult);
    expect(results.getNumPois()).toBe(1);
  });

  it("零条目回包同样原样转发：没有归一化调用面，就没有 empty/failed 可结算", () => {
    const onSearchComplete = vi.fn();
    services.createAutocomplete({ input: input(), onSearchComplete });
    fake.createdAutocompletes[0]!.pois = [];

    fireNativeSearch("不存在的关键字");

    expect(onSearchComplete).toHaveBeenCalledTimes(1);
    expect(
      (onSearchComplete.mock.lastCall as [FakeV4AutocompleteResult])[0].getNumPois(),
    ).toBe(0);
  });

  it("创建与配置写入都不代替输入框发起检索：Driver 一次都不调用 SDK 的 search()", () => {
    const handle = services.createAutocomplete({ input: input() });
    services.setAutocompleteOptions(handle, { location: "上海市", types: ["city"] });

    expect(
      fake.createdAutocompletes[0]!.callLog.filter((entry) => entry.startsWith("search:")),
    ).toEqual([]);
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
});

describe("v4 Service Facet：Autocomplete 释放后不得再回写（R25-C 复审 P1-1）", () => {
  function autocompleteWith(options: Record<string, unknown> = {}) {
    const el = document.createElement("input");
    document.body.appendChild(el);
    return services.createAutocomplete({ input: el, ...options });
  }

  /** 模拟「请求已发、回包未到」：真实 JSONP 的最短延迟也长于一个同步回合。 */
  function pendingNativeSearch() {
    const autocomplete = fake.createdAutocompletes[0]!;
    autocomplete.queue.auto = false;
    autocomplete.search("K");
    return autocomplete;
  }

  it("回包已在路上 → dispose → 迟到回包：不再调用业务 onSearchComplete", () => {
    const onSearchComplete = vi.fn();
    const handle = autocompleteWith({ onSearchComplete });
    const autocomplete = pendingNativeSearch();

    services.disposeAutocomplete(handle);

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

  it("对照组：未释放的实例仍然把回包转给业务回调（守卫不能把正常路径一起关掉）", () => {
    const onSearchComplete = vi.fn();
    autocompleteWith({ onSearchComplete });
    const autocomplete = pendingNativeSearch();

    autocomplete.queue.flush();
    expect(onSearchComplete).toHaveBeenCalledTimes(1);
  });
});

describe("v4 Service Facet：Autocomplete 释放与句柄守卫（八/九轮复审 P2）", () => {
  /** 建一个绑定了输入框的实例，并给出对应的 Fake 实例（取最近创建的那一个）。 */
  function autocompleteAttached() {
    const el = document.createElement("input");
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[fake.createdAutocompletes.length - 1]!;
    return { el, handle, autocomplete };
  }

  it("disposeAutocomplete() 幂等：SDK 的 dispose() 只执行一次", () => {
    const { handle, autocomplete } = autocompleteAttached();

    services.disposeAutocomplete(handle);
    expect(() => services.disposeAutocomplete(handle)).not.toThrow();

    expect(autocomplete.callLog.filter((entry) => entry === "dispose")).toHaveLength(1);
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
  it("disposeAutocomplete() 释放 EventDriver 持有的订阅（分组归零，反复创建/释放不累积）", () => {
    for (let round = 0; round < 3; round += 1) {
      const { handle, autocomplete } = autocompleteAttached();

      events.on(handle, "confirm", vi.fn());
      events.on(handle, "highlight", vi.fn());
      // 两个不同事件类型 ⇒ 两个 raw listener（同类型内的多个 handler 才共用一份）
      expect(autocomplete.getListenerCount()).toBe(2);

      services.disposeAutocomplete(handle);
      expect(autocomplete.getListenerCount(), `第 ${round + 1} 轮释放后订阅必须归零`).toBe(0);
    }
  });

  it("SDK 销毁钩子里重入 disposeAutocomplete()：不会真的销毁两次", () => {
    const { handle, autocomplete } = autocompleteAttached();

    autocomplete.onDispose = () => services.disposeAutocomplete(handle);
    services.disposeAutocomplete(handle);

    expect(autocomplete.callLog.filter((entry) => entry === "dispose")).toHaveLength(1);
  });

  // 八轮复审 P2-2：SDK 销毁抛错时，句柄必须保持「不再接受业务调用」，但**不能**因此
  // 让后续 dispose 直接短路——否则底层资源永远失去重试清理的入口。
  it("SDK dispose 抛错：句柄立即停用，且再次调用会重试未完成的 SDK 清理", () => {
    const onSearchComplete = vi.fn();
    const el = document.createElement("input");
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el, onSearchComplete });
    const autocomplete = fake.createdAutocompletes[0]!;
    // 「请求已发、回包未到」+ 这次 SDK 的 dispose() 抛错
    autocomplete.queue.auto = false;
    autocomplete.search("K");
    autocomplete.failNextDispose = new TypeError("Cannot read properties of undefined");

    expect(() => services.disposeAutocomplete(handle)).toThrow();
    // ① 句柄已停用：迟到回包到达也不再转给业务
    autocomplete.queue.flush();
    expect(onSearchComplete).not.toHaveBeenCalled();

    // ② 再次调用会重试 SDK 清理，并且这次成功
    expect(() => services.disposeAutocomplete(handle)).not.toThrow();
    expect(autocomplete.callLog.filter((entry) => entry === "dispose")).toHaveLength(2);
  });
});



describe("v4 Service Facet：LocalSearch（M7-SERVICE-CORE / #38）", () => {
  /** 纯 headless 实例：不传 renderOptions，因此不会在任何地图上绘制覆盖物。 */
  function localSearchWith(location: string | Point = "北京市", options?: LocalSearchOptions) {
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

  it("disposeLocalSearch：在飞调用显式失败、释放后拒绝新调用、重复调用幂等", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const inflight = services.search(handle, "餐厅");
    services.disposeLocalSearch(handle);
    expect((await inflight.result).status).toBe("failed");
    expect(raw.callLog.filter((entry) => entry === "clearResults")).toHaveLength(1);

    expect((await services.search(handle, "餐厅").result).status).toBe("failed");

    services.disposeLocalSearch(handle);
    expect(raw.callLog.filter((entry) => entry === "clearResults"), "幂等：不再重复清理").toHaveLength(1);
  });

  it("disposeLocalSearch：clearResults 抛错时不记账，下一次重试；泄漏账头保留", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    await services.search(handle, "餐厅").result;
    // 检索交付了一份结果集 ⇒ 未清理前它算一份未释放资源
    expect(fake.diagnostics.snapshot().leaks.localSearchResults).toBe(1);

    raw.failNextClearResults = new Error("clear boom");
    expect(() => services.disposeLocalSearch(handle)).toThrowError(/LocalSearch.clearResults/);
    expect(fake.diagnostics.snapshot().leaks.localSearchResults, "失败不记账").toBe(1);

    services.disposeLocalSearch(handle);
    expect(fake.diagnostics.snapshot().leaks.localSearchResults).toBe(0);
  });

  it("disposeLocalSearch：清理钩子里重入 dispose 不会重复清结果", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    await services.search(handle, "餐厅").result;
    raw.onClearResults = () => services.disposeLocalSearch(handle);

    services.disposeLocalSearch(handle);

    expect(raw.callLog.filter((entry) => entry === "clearResults")).toHaveLength(1);
    expect(fake.diagnostics.snapshot().leaks.localSearchResults).toBe(0);
  });

  it("创建面：renderOptions.map 必须是本库的 MapHandle（绘制所有权可验证）", () => {
    expect(() =>
      services.createLocalSearch("北京市", { renderOptions: { map: {} as never } }),
    ).toThrowError(/renderOptions\.map 必须是本库的 MapHandle/);
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
    expect(() => services.createLocalSearch(42 as never)).toThrowError(/检索区域必须是城市名字符串/);
    expect(() => services.createLocalSearch("")).toThrowError(/不能是空字符串/);

    const point = services.createLocalSearch({ lng: 116.404, lat: 39.915 });
    expect(fake.createdLocalSearches[0]!.location).toMatchObject({ lng: 116.404, lat: 39.915 });
    services.disposeLocalSearch(point);
  });
});


/**
 * 外部评审（PR #89）复现：LocalSearch 的归属与释放
 *
 * 四条都是评审给出的**确定性反例**，先在此复现（红），再改实现；用例留在仓库里当回归。
 * 共同点：归属不能建立在「跨请求按发出顺序回包」这个官方**没有承诺**的前提上。
 */
describe("v4 Service Facet：LocalSearch 归属与释放（PR #89 评审复现）", () => {
  function localSearchWith(location: string | Point = "北京市", options?: LocalSearchOptions) {
    return services.createLocalSearch(location, options);
  }

  /** 落到 SDK 的检索调用（不含构造期记录）。 */
  function searchCalls(): string[] {
    return fake.createdLocalSearches[0]!.callLog.filter((entry) => !entry.startsWith("construct:"));
  }

  it("cancel A 之后，同一实例上的新检索被显式拒绝（不再按到达顺序猜归属）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const a = services.search(handle, "A");
    a.cancel();
    const b = services.search(handle, "B");

    // 关键：B **没有**落到 SDK（旧实现在这里会接受 B，然后把它的乱序回包丢掉 → timeout）
    expect(searchCalls()).toEqual(["search:A:"]);
    const bResult = await b.result;
    expect(bResult.status).toBe("failed");
    expect(bResult.error?.code).toBe("BMAP_SERVICE_FAILED");
    expect(bResult.error?.message).toContain("重建");

    // A 的迟到回包到达：实例已是终态，没有在册操作可被错配
    expect(raw.queue.flush()).toBe(1);
    expect((await a.result).status).toBe("canceled");

    services.disposeLocalSearch(handle);
  });

  it("cancel K 之后重查同一个 K：同样被拒绝，且不会把旧结果交给新请求", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    raw.pois = [{ title: "OLD" }];
    const first = services.search(handle, "K");
    first.cancel();
    raw.pois = [{ title: "NEW" }];
    const second = services.search(handle, "K");

    expect(searchCalls()).toEqual(["search:K:"]);
    const settled = await second.result;
    expect(settled.status, "同关键词重查无法归属时必须显式拒绝").toBe("failed");
    expect(settled.data, "更不得把旧请求的结果交给新请求").toBeNull();

    raw.queue.flush();
    expect((await first.result).status).toBe("canceled");
    services.disposeLocalSearch(handle);
  });

  it("实例身份隔离：换新实例重查同一个关键词，迟到回包不污染新请求（两种到达顺序都对）", async () => {
    const first = localSearchWith();
    const rawFirst = fake.createdLocalSearches[0]!;
    rawFirst.queue.auto = false;

    rawFirst.pois = [{ title: "OLD" }];
    const oldCall = services.search(first, "K");
    oldCall.cancel();
    services.disposeLocalSearch(first);

    // 新实例（评审建议的 supersede 形态）
    const second = localSearchWith();
    const rawSecond = fake.createdLocalSearches[1]!;
    rawSecond.queue.auto = false;
    rawSecond.pois = [{ title: "NEW" }];
    const newCall = services.search(second, "K");

    // 旧实例的迟到回包**先**到（它只能落到旧实例上）
    expect(rawFirst.queue.flush()).toBe(1);
    expect(rawSecond.queue.flush()).toBe(1);

    const settled = await newCall.result;
    expect(settled.status).toBe("success");
    expect((settled.data as LocalSearchResult[])[0]?.pois[0]?.title).toBe("NEW");
    expect((await oldCall.result).status).toBe("canceled");

    services.disposeLocalSearch(second);
  });

  it("超时：给出 timeout；该实例此后拒绝新检索（已在路上的回包不会消失）", async () => {
    vi.useFakeTimers();
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const call = services.search(handle, "餐厅");
    vi.advanceTimersByTime(15000);
    expect((await call.result).status).toBe("timeout");
    // 正证：回包真的还在路上
    expect(raw.queue.pending).toBe(1);

    vi.useRealTimers();
    const retry = services.search(handle, "餐厅");
    expect(searchCalls(), "超时之后的同实例重查不得落到 SDK").toEqual(["search:餐厅:"]);
    expect((await retry.result).status).toBe("failed");
    expect((await retry.result).error?.message).toContain("重建");

    expect(raw.queue.flush()).toBe(1);
    services.disposeLocalSearch(handle);
  });

  it("超时之后的实例永久不可复用：迟到回包到达也不恢复（PR #89 复审 P1）", async () => {
    vi.useFakeTimers();
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const first = services.search(handle, "餐厅");
    vi.advanceTimersByTime(15000);
    expect((await first.result).status).toBe("timeout");
    expect(raw.queue.pending, "正证：迟到回包真的还在路上").toBe(1);

    // 迟到回包到达：它**不该**让实例「恢复可用」（否则同一 handle 的行为取决于回包早晚）
    expect(raw.queue.flush()).toBe(1);

    vi.useRealTimers();
    const retry = services.search(handle, "餐厅");
    expect(searchCalls(), "超时之后的同实例重查不得落到 SDK").toEqual(["search:餐厅:"]);
    const settled = await retry.result;
    expect(settled.status).toBe("failed");
    // 文案必须覆盖**两种**失效来源（cancel 与 timeout 共用 `supersededSearches`）：
    // 只说「被 cancel() 取代」会让「超时后直接用 Driver 重试」的调用方看不懂
    expect(settled.error?.message).toContain("取消或超时");
    expect(settled.error?.message).toContain("重建");

    services.disposeLocalSearch(handle);
  });

  it("首次 gotoPage（还没有结果）也按官方语义回调：INVALID_REQUEST(5)（PR #89 复审 P2）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const paged = services.gotoPage(handle, 1);
    // 官方声明：页码无效时**仍会触发** onSearchComplete，并把状态设为 INVALID_REQUEST
    expect(raw.queue.pending, "Fake 也必须回调，不能建模成 timeout").toBe(1);
    expect(raw.queue.flush()).toBe(1);

    const settled = await paged.result;
    expect(settled.status).toBe("failed");
    expect(settled.error?.code).toBe(5);
    expect(settled.sdkStatus).toBe(5);

    services.disposeLocalSearch(handle);
  });

  it("释放必须调用公开的 clearResults（LocalSearch 没有官方 dispose）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    await services.search(handle, "餐厅").result;

    services.disposeLocalSearch(handle);

    // 官方 LocalSearch 没有 dispose()：清掉它画出的结果必须走 clearResults()
    expect(raw.callLog, "释放路径必须落到公开的 clearResults").toContain("clearResults");
    expect(
      (raw as unknown as { dispose?: unknown }).dispose,
      "Fake 不得为 LocalSearch 虚构 dispose（它不在官方声明里）",
    ).toBeUndefined();
  });

  it("多关键字检索之后 gotoPage 仍能结算（不再有上一次关键字的残留判据）", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.pois = [{ title: "P0" }, { title: "P1" }];
    raw.options.pageCapacity = 1;

    await services.search(handle, "A").result;
    const multi = await services.search(handle, ["B", "C"]).result;
    expect(multi.status).toBe("success");

    // 不结算就会挂到用例超时（回包经微任务到达，这里直接 await）
    const paged = await services.gotoPage(handle, 0).result;
    expect(paged.status, "多关键字之后翻页不该被判成「不属于本次」").toBe("success");

    services.disposeLocalSearch(handle);
  });

  it("单实例串行：上一个检索未结算时，新调用被显式拒绝且一次都不落到 SDK", async () => {
    const handle = localSearchWith();
    const raw = fake.createdLocalSearches[0]!;
    raw.queue.auto = false;

    const a = services.search(handle, "A");
    const b = services.search(handle, "B");
    const bResult = await b.result;
    expect(bResult.status).toBe("failed");
    expect(bResult.error?.message).toContain("未结算");
    expect(searchCalls()).toEqual(["search:A:"]);

    raw.queue.flush();
    expect((await a.result).status).toBe("success");
    services.disposeLocalSearch(handle);
  });
});
