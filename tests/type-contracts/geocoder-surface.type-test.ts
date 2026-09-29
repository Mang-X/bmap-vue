/**
 * 地理编码两个 hook 的**公开动作名 / 结果别名**的类型面契约（issue #165）
 *
 * ## 钉住什么
 *
 * 官方 `BMap.Geocoder` 只有两个成员：`getPoint(address, cb, city?)` 与
 * `getLocation(point, cb, options?)`。同一能力 ⇒ 同名（#165 的口径）——我们此前在
 * composable 面上既改了动作名（`get`），又给**同一个 ref** 挂了四个名字
 * （`data` / `location` / `point` / `result`），其中 `location` 还与官方
 * `getLocation` 的语义**相反**（官方 `location` 是地址，我们是坐标点）。
 *
 * 收敛后的契约：
 *
 * - `useGeocoder().getPoint` —— 正地址解析（官方 `Geocoder#getPoint`）；
 * - `useGeocodeDetail().getLocation` —— 逆地址解析（官方 `Geocoder#getLocation`）；
 * - 两个 hook 的结果都**只有** `data` 一个读取口；`location` / `point` / `result`
 *   三个别名**不存在**（不保留 deprecated 别名，见 #165 §3.6「清除旧 API 包袱」）。
 *
 * `location` / `point` / `result` 与 `get` 在运行期是同一个值或同一个函数，
 * **只有类型层能判别**——所以这个断言必须被 `vue-tsc` 编译，因此落在
 * `tests/type-contracts/`（`tsconfig.build.json` 排除 `src/` 下的 `*.test.ts`、
 * `tsconfig.tests.json` 只收 performance，详见 `tsconfig.type-contracts.json` 的注释）。
 *
 * **判别力是双向的**：`@ts-expect-error` 在错误消失时变成 TS2578（unused）而翻红；
 * 正控保证不是在「类型退化成什么都能收」的前提下恒绿。
 */
import type { useGeocoder } from "../../packages/bmap-vue/src/composables/useGeocoder";
import type { useGeocodeDetail } from "../../packages/bmap-vue/src/composables/useGeocodeDetail";

declare const geo: ReturnType<typeof useGeocoder>;
declare const detail: ReturnType<typeof useGeocodeDetail>;

/* ------------------------------------------------------ useGeocoder：动作名对齐官方 */

const _geocodeOnce: Promise<unknown> = geo.getPoint("北京市海淀区中关村");
const _geocodeInCity: Promise<unknown> = geo.getPoint("天安门", "北京市");
const _geocodeBatch: Promise<unknown> = geo.getBatch(["北京", "上海"]);

// @ts-expect-error 官方成员是 `getPoint`；`get` 已于 #165 删除，不保留兼容别名
geo.get;
// @ts-expect-error `city` 仍是可选第二参：省略即不做城市限定，不接受第三参
geo.getPoint("天安门", "北京市", "多余");

/* ------------------------------- useGeocoder：结果只有 `data` 一个读取口（去掉三个别名） */

// @ts-expect-error 官方 `getLocation` 的 location 是**地址**；我们是坐标点，留着会指向错的成员
geo.location;
// @ts-expect-error 坐标点走 `getPoint` 的返回值 / `getBatch` 的逐项 `point`；`data` 是唯一入口
geo.point;
// @ts-expect-error `result` 是 v2 习惯别名，#165 §3.6 要求清除
geo.result;

/* ------------------------------------------ useGeocodeDetail：逆解析动作名对齐官方 */

const _detailOnce: Promise<unknown> = detail.getLocation({ lng: 116.404, lat: 39.915 });
const _detailBatch: Promise<unknown> = detail.getBatch([{ lng: 116.404, lat: 39.915 }]);

// @ts-expect-error 逆解析的官方成员是 `getLocation`；`get` 已于 #165 删除
detail.get;
// @ts-expect-error 逆解析不接受 `city`（官方 `getLocation` 的第三参是 `LocationOptions`）
detail.getLocation({ lng: 1, lat: 2 }, "北京市");

// @ts-expect-error `result` 是 v2 习惯别名，#165 §3.6 要求清除（与 `useGeocoder` 同口径）
detail.result;

/* ----------------------------------------------------------------- 正控：仍存在的面 */

const _geoData: unknown = geo.data;
const _geoStatus: unknown = geo.status;
const _geoCancel: unknown = geo.cancel;
const _geoReset: unknown = geo.reset;
const _detailData: unknown = detail.data;
const _detailStatus: unknown = detail.status;
const _detailCancel: unknown = detail.cancel;
const _detailReset: unknown = detail.reset;

/** 引用全部 fixture，避免「未使用」类诊断把它们当死代码。 */
export const geocoderSurfaceFixtures = [
  _geocodeOnce,
  _geocodeInCity,
  _geocodeBatch,
  _detailOnce,
  _detailBatch,
  _geoData,
  _geoStatus,
  _geoCancel,
  _geoReset,
  _detailData,
  _detailStatus,
  _detailCancel,
  _detailReset,
];
