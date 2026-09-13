/**
 * UI Kit 薄封装的事件 DTO、公开动作与「不重复请求」（R25-D / issue #73）
 *
 * 对应 issue 的验收点：
 * - 「两组件…发出正确事件」；
 * - 「单次交互不重复发出 UI/headless 两套请求」；
 * - 「DTO 不泄漏 BMap/BMapGL 类型」；
 * - 实施步骤 5「只映射已验证公开 setter/事件」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import BPlaceAutocomplete from "../../packages/baidu-map-gl-vue/src/integrations/ui-kit/components/BPlaceAutocomplete.vue";
import BPlaceSearch from "../../packages/baidu-map-gl-vue/src/integrations/ui-kit/components/BPlaceSearch.vue";
import {
  createFakeMapHarness,
  createFakeUiKit,
  currentFakeUiKit,
  installFakeUiKit,
  mountInMap,
  type FakeMapHarness,
  type FakeUiKit,
} from "./ui-kit-harness";

vi.mock("@baidumap/jsapi-ui-kit", async () => {
  const harness = await import("./ui-kit-harness");
  return harness.uiKitModuleMock();
});

interface SearchApi extends Record<string, unknown> {
  search(keyword: string, option?: { city?: string }): Promise<void>;
  searchNearby(keyword: string, center: { lng: number; lat: number }, radius?: number): Promise<void>;
  searchInBounds(
    keyword: string,
    bounds: { sw: { lng: number; lat: number }; ne: { lng: number; lat: number } },
  ): Promise<void>;
  prevPage(): Promise<void>;
  nextPage(): Promise<void>;
  goToPage(page: number): Promise<void>;
}

interface AutocompleteApi extends Record<string, unknown> {
  search(keyword: string): Promise<void>;
  setInputValue(value: string): Promise<void>;
  getInputValue(): Promise<string>;
  setLocation(location: string): Promise<void>;
  setCitylimit(citylimit: boolean): Promise<void>;
  setTypes(types: "all" | "city"): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
}

let fake: FakeUiKit;

beforeEach(() => {
  fake = createFakeUiKit();
  installFakeUiKit(fake);
});

function readyHarness(label = "map"): FakeMapHarness {
  const harness = createFakeMapHarness();
  harness.ready(harness.makeMapHandle(label));
  return harness;
}

/** `child.emitted()` 的返回类型来自组件 emits 推断（这里是 SFC，只能拿到 `{}`），统一按「事件名 → 参数数组」读。 */
function emittedOf(mounted: { child: { emitted(): unknown } }): Record<string, unknown[][] | undefined> {
  return mounted.child.emitted() as Record<string, unknown[][] | undefined>;
}

/** 上游 `suggest` / `select` 真实回包的形状（`point` 是 raw Point 实例）。 */
function upstreamSuggestion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    province: "北京市",
    city: "北京市",
    district: "海淀区",
    name: "百度大厦",
    // 上游 `@deprecated` 字段：我们刻意不转发。
    street: "百度大厦",
    business: "上地",
    address: "上地十街 10 号",
    tag: "公司",
    uid: "abc-uid",
    point: { lng: 116.307, lat: 40.056, __raw: "raw-point-instance" },
    ...overrides,
  };
}

describe("事件 → 公共 DTO", () => {
  it("PlaceAutocomplete：suggest / select / highlight 都投影成纯数据，丢弃 deprecated 字段", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();
    const widget = fake.instances[0]!;

    widget.emit("suggest", [upstreamSuggestion()]);
    widget.emit("select", upstreamSuggestion({ name: "选中项" }));
    widget.emit("highlight", { index: 2, value: upstreamSuggestion({ name: "高亮项" }) });
    await nextTick();

    const emitted = emittedOf(mounted);
    const suggest = emitted.suggest?.[0]?.[0] as Record<string, unknown>[];
    expect(suggest).toHaveLength(1);
    expect(suggest[0]).toMatchObject({
      name: "百度大厦",
      city: "北京市",
      district: "海淀区",
      uid: "abc-uid",
      // raw Point 被归一成纯数据，且**不带**上游实例上的其它字段。
      point: { lng: 116.307, lat: 40.056 },
    });
    // `street` 是上游标注的 deprecated 别名，公共 DTO 不转发。
    expect(Object.keys(suggest[0]!)).not.toContain("street");

    const select = emitted.select?.[0]?.[0] as Record<string, unknown>;
    expect(select.name).toBe("选中项");

    const highlight = emitted.highlight?.[0]?.[0] as { index: number; value: Record<string, unknown> };
    expect(highlight.index).toBe(2);
    expect(highlight.value.name).toBe("高亮项");

    mounted.unmount();
  });

  it("PlaceAutocomplete：异常载荷不抛错也不发事件（非数组 / 非对象 / 坏坐标）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();
    const widget = fake.instances[0]!;

    widget.emit("suggest", "not-an-array");
    widget.emit("select", null);
    widget.emit("highlight", { index: "0", value: upstreamSuggestion() });
    await nextTick();

    const emitted = emittedOf(mounted);
    // `suggest` 收到非数组 → 按空数组处理（事件仍发出，业务不必判空）。
    expect(emitted.suggest?.[0]?.[0]).toEqual([]);
    // 载荷不可用时**不发**事件：不制造「看起来有一次选择」的假信号。
    expect(emitted.select).toBeUndefined();
    expect(emitted.highlight).toBeUndefined();

    // 坐标非法（NaN）时点被丢弃，但其余字段照常保留。
    widget.emit("suggest", [upstreamSuggestion({ point: { lng: Number.NaN, lat: 1 } })]);
    await nextTick();
    const secondSuggest = emittedOf(mounted).suggest?.[1]?.[0] as Record<string, unknown>[];
    expect(secondSuggest[0]!.point).toBeUndefined();

    mounted.unmount();
  });

  it("PlaceSearch：load / select 投影成 POI DTO，事件名与上游一致", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceSearch, harness, {});
    await flushPromises();
    const widget = fake.instances[0]!;
    expect(widget.listeners.has("load")).toBe(true);
    expect(widget.listeners.has("select")).toBe(true);

    const poi = {
      title: "百度大厦",
      address: "上地十街 10 号",
      uid: "poi-uid",
      tel: "010-00000000",
      point: { lng: 116.307, lat: 40.056, __raw: "raw-point-instance" },
      // 上游回包里可能带着大量额外字段，公共 DTO 只保留约定字段。
      detail_info: { ignored: true },
    };
    widget.emit("load", [poi]);
    widget.emit("select", poi);
    await nextTick();

    const emitted = emittedOf(mounted);
    expect(emitted.load?.[0]?.[0]).toEqual([
      {
        title: "百度大厦",
        address: "上地十街 10 号",
        uid: "poi-uid",
        tel: "010-00000000",
        point: { lng: 116.307, lat: 40.056 },
      },
    ]);
    expect(emitted.select?.[0]?.[0]).toEqual({
      title: "百度大厦",
      address: "上地十街 10 号",
      uid: "poi-uid",
      tel: "010-00000000",
      point: { lng: 116.307, lat: 40.056 },
    });

    mounted.unmount();
  });
});

describe("公开动作", () => {
  it("PlaceAutocomplete：动作逐个落到已验证的公开方法上", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as AutocompleteApi;
    const widget = fake.instances[0]!;

    await api.search("百度大厦");
    await api.setInputValue("已写入");
    await expect(api.getInputValue()).resolves.toBe("value-from-autocomplete");
    await api.setLocation("上海");
    await api.setCitylimit(true);
    await api.setTypes("city");
    await api.show();
    await api.hide();

    expect(widget.calls).toEqual([
      { method: "search", args: ["百度大厦"] },
      { method: "setInputValue", args: ["已写入"] },
      { method: "getInputValue", args: [] },
      { method: "setLocation", args: ["上海"] },
      { method: "setCitylimit", args: [true] },
      { method: "setTypes", args: ["city"] },
      { method: "show", args: [] },
      { method: "hide", args: [] },
    ]);
    // 不承诺 v-model:query：公开动作面恰好是「已验证 setter + 读取输入框」，没有 query 通道。
    expect(Object.keys(mounted.exposed.value ?? {}).sort()).toEqual(
      [
        "status",
        "search",
        "setInputValue",
        "getInputValue",
        "setLocation",
        "setCitylimit",
        "setTypes",
        "show",
        "hide",
      ].sort(),
    );

    mounted.unmount();
  });

  it("PlaceSearch：检索 / 翻页动作与上游签名一致，且坐标先经 Driver 转 raw Point", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceSearch, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as SearchApi;
    const widget = fake.instances[0]!;

    await api.search("百度大厦", { city: "北京" });
    await api.searchNearby("咖啡", { lng: 116.4, lat: 39.9 }, 1500);
    await api.searchInBounds("学校", { sw: { lng: 116.2, lat: 39.8 }, ne: { lng: 116.5, lat: 40.1 } });
    await api.prevPage();
    await api.nextPage();
    await api.goToPage(3);

    expect(widget.callsOf("search")).toEqual([
      { method: "search", args: ["百度大厦", { city: "北京" }] },
    ]);
    // 周边 / 范围检索的坐标必须由 Driver 转换（上游把它们直接塞进请求，裸对象会被挡）。
    expect(harness.toRawPointCalls).toEqual([
      { lng: 116.4, lat: 39.9 },
      { lng: 116.2, lat: 39.8 },
      { lng: 116.5, lat: 40.1 },
    ]);
    expect(widget.callsOf("searchNearby")).toEqual([
      { method: "searchNearby", args: ["咖啡", { __rawPoint: true, lng: 116.4, lat: 39.9 }, 1500] },
    ]);
    expect(widget.callsOf("searchInBounds")).toEqual([
      {
        method: "searchInBounds",
        args: [
          "学校",
          {
            sw: { __rawPoint: true, lng: 116.2, lat: 39.8 },
            ne: { __rawPoint: true, lng: 116.5, lat: 40.1 },
          },
        ],
      },
    ]);
    expect(widget.calls.slice(-3).map((call) => call.method)).toEqual([
      "prevPage",
      "nextPage",
      "goToPage",
    ]);

    mounted.unmount();
  });

  it("单次交互只走 UI Kit：headless 服务面一次都没被读到", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceSearch, harness, {});
    await flushPromises();
    const api = mounted.exposed.value as unknown as SearchApi;

    await api.search("百度大厦");
    await flushPromises();

    // 正证守卫：记账本身有效（构造期确实读过 driver.geometry）。
    expect(harness.propertyAccesses).toContain("driver.geometry");
    // headless 检索的唯一入口是 driver.services；一次都不能出现。
    expect(harness.propertyAccesses.filter((path) => path.includes("services"))).toEqual([]);
    expect(harness.propertyAccesses.filter((path) => path.includes("rawSdk"))).toEqual([]);
    // 一次交互 = 一次上游调用，没有第二条通道。
    expect(fake.instances[0]!.callsOf("search")).toHaveLength(1);

    mounted.unmount();
  });
});

describe("props → 已验证 setter", () => {
  it("运行期可变的 props 会镜像到对应 setter", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {
      location: "北京",
      citylimit: true,
      types: "city",
    });
    await flushPromises();
    const widget = fake.instances[0]!;

    // 构造选项带上了初始值（不需要构造后再补一次 setter）。
    expect(widget.options.location).toBe("北京");
    expect(widget.options.citylimit).toBe(true);
    expect(widget.options.types).toBe("city");
    expect(widget.calls).toEqual([]);

    mounted.props.value = { location: "上海", citylimit: false, types: "all" };
    await nextTick();

    expect(widget.callsOf("setLocation").map((call) => call.args)).toEqual([["上海"]]);
    expect(widget.callsOf("setCitylimit").map((call) => call.args)).toEqual([[false]]);
    expect(widget.callsOf("setTypes").map((call) => call.args)).toEqual([["all"]]);
    // 只是镜像，不是重建。
    expect(fake.stats.created).toBe(1);

    mounted.unmount();
  });

  it("构造期选项变更不触发 setter / 重建（文档承诺「需重新挂载」）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, { placeholder: "搜地点", debounce: 300 });
    await flushPromises();
    const widget = fake.instances[0]!;

    expect(widget.options.placeholder).toBe("搜地点");
    expect(widget.options.debounce).toBe(300);

    mounted.props.value = { placeholder: "换个提示", debounce: 800 };
    await nextTick();

    expect(widget.calls).toEqual([]);
    expect(fake.stats.created).toBe(1);
    expect(fake.stats.destroyed).toBe(0);

    mounted.unmount();
  });

  it("缺省的布尔 props 不得把上游默认值改掉（Vue 的 Boolean 缺省即 false 陷阱）", async () => {
    const harness = readyHarness();
    const mounted = mountInMap(BPlaceAutocomplete, harness, {});
    await flushPromises();

    const options = fake.instances[0]!.options;
    // 上游：`citylimit` 默认 false、`showSuggestion` 默认 true。
    // 若声明成 `showSuggestion?: boolean` 而不给默认值，Vue 会把缺省值当 false，
    // 于是我们传下去的就是 `showSuggestion: false` —— 静默关掉官方默认开启的下拉。
    expect(options.citylimit).toBe(false);
    expect(options.showSuggestion).toBe(true);
    // 没给过的选项必须**不出现**，否则会覆盖上游自己的默认值。
    expect("minLength" in options).toBe(false);
    expect("suggestionCount" in options).toBe(false);
    expect("display" in options).toBe(false);

    mounted.unmount();
  });
});
