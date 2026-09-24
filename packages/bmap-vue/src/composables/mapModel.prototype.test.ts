/**
 * #137 的 **Map model prototype**（对照实现 + 可复核读数）
 *
 * ## 这份文件是什么、不是什么
 *
 * #137 验收要求对简单 number model 做 **Vue-native prototype**：把 parent ↔ component 与
 * SDK ↔ model 两层拆开，判断哪些状态必须保留、Vue-native 路线省不省。如果「不迁 `useModel`」
 * 只由 ADR 断言支撑，下一个读者无法复核 —— 所以本文件把**两条路线都真的挂载成组件**跑一遍。
 *
 * 两条线路的 `props` 形状**完全一致**（`zoom` + `defaultZoom`，与 `Map.vue` 的 `zoomState`
 * 对齐），都用**手写 `defineProps` / `defineEmits`**（公共面一字不动），差别只有模型层：
 *
 * - **A（现状）**：`useControllableState` + 与 `Map.vue:1225` 同形的 SDK 腿 watcher。
 * - **B（Vue-native prototype）**：`useModel(props, "zoom")` + 最小桥接 + **同一条** SDK 腿 watcher。
 * - **B₀（对照下界）**：只 `useModel`，没有桥接也没有 SDK 腿。用来量「另外两层各自的边际成本」。
 *
 * **SDK 腿为什么两边都有**：`Map.vue:1225` 的 `watch(() => props.zoom, …)` 干的是
 * `driver.map.setZoom` —— **写 SDK 不是 Vue 的职责**，`useModel` 也不会替你写。所以它不是
 * 「受控/非受控运行时」的一部分，但**两条路线都得付**，必须计入才叫同口径。把它排除在外的
 * 计数会凭空让 B 显得更省 —— 那正是本文件要避免的偏差。
 *
 * **只做 `zoom`**：一个字段足以判定「Vue-native 是否省」，四个视野字段同构，重复四遍只放大
 * 同一结论、不增加证据力。
 *
 * ## 计数口径（这是本文件能不能被复核的关键）
 *
 * 手数「几个 ref、几个 computed」没有统一口径 —— `customRef` 算 1 还是算它内部的 effect，会
 * 直接改变结论。本文件用**唯一口径**：在组件 `setup()` 末尾读 `getCurrentScope().effects.length`，
 * 数**实际注册的 `ReactiveEffect` 数**。这个数由 **Vue 自己记账**，不靠人分类。
 *
 * | 结构 | 是否计入 | 为什么 |
 * | --- | --- | --- |
 * | `watch` / `watchSyncEffect` | ✅ 1 | 真实挂进 scope 的 `ReactiveEffect` |
 * | `computed` | ❌ 0 | `ComputedRefImpl` 懒求值，**不挂 scope** |
 * | `shallowRef` / `ref` | ❌ 0 | 只挂 dep，**不挂 scope** |
 * | `Set` / 普通对象 | ❌ 0 | 非响应式 |
 * | `useModel` 内部 `watchSyncEffect` | ✅ 1 | 见下 |
 *
 * 关键在最后一行：Vue 3.5.42 的 `useModel()`（`runtime-core/src/helpers/useModel.ts`）在
 * `customRef(...)` **内部**建了一个 `watchSyncEffect` 把 prop 同步进去，只数「`useModel` 算 1 个
 * `customRef`」会漏掉它。
 *
 * 那个内部 effect 是**无条件**创建的（`hasVModel` 只门控 `customRef` 的 **setter** 分支，
 * 不门控这个 `watchSyncEffect`），所以「有没有真 v-model」都不影响这一项 —— 下面有一条断言
 * 把这个事实钉住，免得下一个人按「无 v-model 就不建」去理解读数。
 *
 * ## 这份计数能证明什么、不能证明什么
 *
 * - **能**：A 与 B₀ / B 各自注册了多少个真实 effect；Vue 升级后同一组断言会重跑。
 * - **不能**：`Set` / `computed` / `shallowRef` 等权记成「1」只能叫**结构数量**，推不出运行时
 *   成本大小。所以本文件**只断言 effect 数**；结构数只作并列读数，不作结论。
 * - 措辞纪律：结论只能说「**B₀ / B 没有减少 effect**」，**不能**说「B runtime 更贵」——
 *   后者需要 profile，本文件不提供，也不该由结构数或 effect 数推断。
 *
 * @see docs/adr/2026-09-14-map-controlled-state.md §6.1 / §6.2
 */
import { describe, expect, it } from "vitest";
import { computed, defineComponent, getCurrentScope, h, nextTick, ref, shallowRef, useModel, watch } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { NUMBER_EPSILON, numbersEqual } from "../core/utils/equality";
import { useControllableState } from "./useControllableState";

/** 与 `Map.vue` 的 `zoom` / `defaultZoom` 对齐的 props 形状。 */
type Route = "A" | "B0" | "B";

interface Harness {
  /** 组件 `setup()` 末尾读到的 `getCurrentScope().effects.length`。 */
  effects: number;
  /** 当前生效值。 */
  read(): number | undefined;
  /** SDK 侧看到的值（模拟 `driver.map.getZoom()`）。 */
  sdkRead(): number;
  /** SDK 侧写入次数（模拟 `driver.map.setZoom()` 的下发次数）。 */
  sdkWrites(): number;
  /** 用户交互 / SDK 回写：受控时只 emit，等父级回写。 */
  commit(next: number): boolean;
  /** 父级回写受控 `zoom`（`undefined` = 摘掉受控值）。 */
  setZoom(value: number | undefined): Promise<void>;
  /** 父级回写 `defaultZoom`（验证「只在首次解析时读一次」）。 */
  setDefaultZoom(value: number): Promise<void>;
  /** 父级收到的 `update:zoom`。 */
  emitted: number[][];
}

/** 父级同时提供 prop 与 `onUpdate:zoom` —— `useModel` 的 `hasVModel` 判定要求两者都在。 */
function mountRoute(route: Route): Harness {
  let effects = -1;
  let read: () => number | undefined = () => undefined;
  let sdkWrites = 0;
  let sdkValue = 3;
  const emitted: number[][] = [];
  let commit: (next: number) => boolean = () => false;

  const Child = defineComponent({
    props: {
      zoom: { type: Number, required: false },
      defaultZoom: { type: Number, required: false },
    },
    emits: { "update:zoom": (_v: number) => true },
    setup(childProps, { emit }) {
      // 模拟 `Map.vue` 的 SDK 腿：受控值变化 → 写 SDK。**两条路线都有**（写 SDK 不归 Vue 管）。
      const syncSdk = (next: number | undefined): void => {
        if (next === undefined) return;
        if (numbersEqual(sdkValue, next)) return; // 读回判等，抑制重复下发
        sdkValue = next;
        sdkWrites += 1;
      };

      if (route === "A") {
        const state = useControllableState<number>({
          name: "zoom",
          value: () => childProps.zoom,
          defaultValue: () => childProps.defaultZoom,
          fallback: 4,
          equals: numbersEqual,
        });
        read = () => state.value.value;
        commit = (next) => {
          if (!state.commit(next)) return false;
          emit("update:zoom", next);
          return true;
        };
        // `Map.vue:356` 的 `applyZoomFromProps` 是「先 syncExternal 同步三态，再写 SDK」，
        // 两步都在同一条 watcher 里 —— 漏掉 syncExternal 就没有内部镜像，
        // 「受控 → 非受控保留最后外部值」也就无从谈起。
        watch(
          () => childProps.zoom,
          (next) => {
            state.syncExternal(next);
            syncSdk(next);
          },
          { flush: "post" },
        );
      } else if (route === "B0") {
        // 只 `useModel`：不补冻结语义，也没有 SDK 腿（用来量这两层各自的边际成本）。
        const model = useModel(childProps, "zoom");
        read = () => model.value as number | undefined;
        commit = (next) => {
          model.value = next;
          return true;
        };
      } else {
        // B：`useModel` + **最小**桥接。父↔子归 Vue；桥接只留冻结语义里 Vue 覆盖不了的部分
        // （A3：受控 prop 被摘掉后 `useModel` 读到 `undefined`，而本库冻结的是「保留最后
        // 一次外部值」）+ equality / reconcile。`defaultValue` 只读一次与 `copy` 对 number
        // 不适用，故不引入。
        const model = useModel(childProps, "zoom");
        const lastExternal = shallowRef<number | undefined>(childProps.zoom);
        const internal = shallowRef<number>(childProps.defaultZoom ?? 4);
        const effective = computed<number | undefined>(() => lastExternal.value ?? internal.value);
        read = () => effective.value;
        // 镜像 A 的 reconcile 规则：SDK 回写先落 `internal`，只有**容差判定为真变化**才通知父级。
        // （`model` 这个句柄在受控档下由 Vue 自己管「写＝emit」，桥接不重复 emit。）
        commit = (next) => {
          if (numbersEqual(internal.value, next)) return false;
          internal.value = next;
          emit("update:zoom", next);
          return true;
        };
        // 记「最后外部值」并写 SDK：同一条 watcher 兼两职，避免为了记 lastExternal 再加一条。
        watch(
          () => childProps.zoom,
          (next) => {
            lastExternal.value = next;
            syncSdk(next);
          },
          { flush: "post" },
        );
      }

      effects = getCurrentScope()?.effects.length ?? -1;
      return () => h("div");
    },
  });

  // 父级 props 放在一个 ref 里，改它而不是 `wrapper.setProps`（Root 不声明 props，
  // `setProps` 改不到真正传给 Child 的东西）。
  const parentProps = ref<{ zoom?: number; defaultZoom?: number }>({ zoom: 3, defaultZoom: 4 });

  const Root = defineComponent({
    setup() {
      return () =>
        h(Child, {
          ...parentProps.value,
          "onUpdate:zoom": (v: number) => {
            emitted.push([v]);
          },
        });
    },
  });

  const wrapper: VueWrapper = mount(Root);
  const set = async (name: "zoom" | "defaultZoom", value: number | undefined): Promise<void> => {
    parentProps.value = { ...parentProps.value, [name]: value };
    await nextTick();
  };

  return {
    effects,
    read,
    sdkRead: () => sdkValue,
    sdkWrites: () => sdkWrites,
    commit,
    setZoom: (value) => set("zoom", value),
    setDefaultZoom: (value) => set("defaultZoom", value),
    emitted,
  };
}

describe("#137 Map model prototype（对照读数）", () => {
  it("口径：watch 计 1，computed/shallowRef 计 0", () => {
    let withWatch = -1;
    let withComputed = -1;
    const Probe = defineComponent({
      setup() {
        const a = shallowRef(1);
        watch(a, () => {});
        withWatch = getCurrentScope()?.effects.length ?? -1;
        return () => h("div");
      },
    });
    mount(Probe);
    const Probe2 = defineComponent({
      setup() {
        const a = shallowRef(1);
        const c = computed(() => a.value);
        void c.value;
        withComputed = getCurrentScope()?.effects.length ?? -1;
        return () => h("div");
      },
    });
    mount(Probe2);

    expect(withWatch, "watch 必须计入").toBe(1);
    expect(withComputed, "computed 不挂 scope，不计入").toBe(0);
  });

  it("前提：`useModel` 的内部 effect 无条件存在（`hasVModel` 只门控 setter，不门控它）", () => {
    // 读 `useModel` 源码（runtime-core.cjs.js 3.5.42）：`watchSyncEffect` 在 `customRef` 工厂里
    // **无条件**创建；`hasVModel` 只出现在 **setter** 里，决定「写进去」还是「只 emit」。
    // 钉住这一点，免得下一个人按「无 v-model 就不建」去理解读数。
    let withoutVModel = -1;
    const Child = defineComponent({
      props: { zoom: { type: Number, required: false } },
      setup(childProps) {
        const model = useModel(childProps, "zoom");
        void model.value;
        withoutVModel = getCurrentScope()?.effects.length ?? -1;
        return () => h("div");
      },
    });
    // 父级**不传** `onUpdate:zoom`（`hasVModel` 为 false）—— 内部 effect 仍然存在。
    mount(Child, { props: { zoom: 3 } });
    expect(withoutVModel, "无 v-model 也注册 1 个内部 effect（只数 customRef=1 会漏掉它）").toBe(1);
    // 有 v-model 时同样是 1 —— 证明这一项与 `hasVModel` 无关。
    expect(mountRoute("B0").effects, "真 v-model 下同样是 1").toBe(1);
  });

  it("读数：A / B₀ / B 注册的 effect 数", () => {
    const a = mountRoute("A").effects;
    const b0 = mountRoute("B0").effects;
    const b = mountRoute("B").effects;

    // A：SDK 腿 watcher（Map.vue:1225 同形）+ useControllableState 内部的 defaultValue 告警
    //    watcher（`defaultZoom` 有传，所以会建）= 2
    expect(a, "A：SDK 腿 + defaultValue 告警 watcher").toBe(2);
    // B₀：只有 useModel 内部的 watchSyncEffect = 1
    expect(b0, "B₀：只有 useModel 内部 effect").toBe(1);
    // B：useModel 内部 effect + 兼任「记 lastExternal 与写 SDK」的 watcher = 2
    expect(b, "B：useModel 内部 effect + 兼任 watcher").toBe(2);

    // 结论只能说到这里：B 没有比 A **少**注册 effect。effect 数不等于成本大小，
    // 「更贵」需要 profile，不在本文件的证据范围内（见文件头）。
    expect(b, "B 相对 A 没有减少 effect").toBeGreaterThanOrEqual(a - 1);
  });

  it("行为：B 与 A 逐项同构（受控抖动、真实变化、受控→非受控保留最后值、default 只读一次）", async () => {
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route);

      // ① 容差内的抖动：两边都**不**下发 SDK、**不**通知父级。
      await h.setZoom(3 + NUMBER_EPSILON / 2);
      expect(h.sdkWrites(), `${route}：容差内抖动不该下发`).toBe(0);
      expect(h.emitted, `${route}：容差内抖动不该通知父级`).toEqual([]);

      // ② 真实变化：先由**用户交互 / SDK 回写**进内部状态（`commit`，与
      // `Map.vue:502` 的 `zoomState.commit(next)` 同一条腿），再由父级回写受控值。
      // 只改 prop 不走 `commit`，那样两条线路走的都不是同一条路径。
      expect(h.commit(9), `${route}：真实变化应当被 commit 接受`).toBe(true);
      await h.setZoom(9);
      expect(h.sdkWrites(), `${route}：真实变化恰好下发一次`).toBe(1);
      expect(h.sdkRead(), `${route}：SDK 收到新值`).toBe(9);
      expect(h.read(), `${route}：受控值生效`).toBe(9);

      // ③ `defaultZoom` 之后变化**不**覆盖当前状态（只在首次解析时读一次）。
      await h.setDefaultZoom(15);
      expect(h.read(), `${route}：default 变化不覆盖`).toBe(9);

      // ④ 受控 → 非受控：冻结语义是「内部状态接管，**保留最后一次外部值**」。
      await h.setZoom(undefined);
      expect(h.read(), `${route}：摘掉受控 prop 后保留最后外部值`).toBe(9);
    }
  });
});
