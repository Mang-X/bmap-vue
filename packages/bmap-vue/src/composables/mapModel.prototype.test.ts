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
 * **B 必须真的用 `useModel` 承担父子通道**（复审 P1 指出过一个假阳性版本）：早先的 B 虽然
 * 调了 `useModel`，但读取走 `effective`、父级变化走 `watch(props.zoom)`、写回直接 `emit` ——
 * `model` **从未参与任何读写**，只是个被拿来计数的死对象。删掉整行 `useModel` 行为断言仍然
 * 全过（已实测）。现在 `model` 是**唯一**父子通道：受控值从 `model.value` 读，写回走
 * `model.value = next`；删掉它会让**两条行为用例都变红**（已实测）—— 这是「B 真的是 Vue-native
 * 路线」的可复核证据。
 *
 * **SDK 腿为什么两边都有**：`Map.vue:1225` 的 `watch(() => props.zoom, …)` 干的是
 * `driver.map.setZoom` —— **写 SDK 不是 Vue 的职责**，`useModel` 也不会替你写。所以它不是
 * 「受控/非受控运行时」的一部分，但**两条路线都得付**，必须计入才叫同口径。把它排除在外的
 * 计数会凭空让 B 显得更省 —— 那正是本文件要避免的偏差。
 *
 * **两条 SDK 路径必须分开测**（复审 P1 指出，早先版本把它们混成一条）：
 * ① **父级受控更新**：SDK 还在 3，父级要求 9 ⇒ 恰好下发**一次** `setZoom(9)`。
 * ② **用户交互闭环**：用户缩放 ⇒ **SDK 自己先变成 9** ⇒ 事件触发 `commit(9)` + `update:zoom`
 * ⇒ 父级回写 9 ⇒ watcher 读回发现 SDK 已是 9 ⇒ **0 次额外写入**。
 * 早先版本只 `commit` 而不动模拟 SDK，等于把①当成②，两条线路**一起模拟错**却仍然互相一致。
 *
 * **冻结契约要两边都实现才可比**：本库冻结了「`default*` 后续写入不生效**并告警一次**」、
 * 「档位切换按规则**告警一次**」、`reset()` 归位。**告警是可观察行为**（`devWarn` 有输出），
 * 不是内部细节 —— A 的第二个 effect 正是 `defaultValue` 告警 watcher。早先的 B **没有实现告警**，
 * 却拿 2 vs 2 去论证「没有更省」：那是**拿不同契约作比较**。补齐后 **B 变成 3**（见下）。
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
 * - 措辞纪律：结论只能说「**在同等冻结契约下，B 注册的 effect 不比 A 少**（实测 3 vs 2）」，
 *   **不能**说「B runtime 更贵」—— 后者需要 profile，本文件不提供，也不该由结构数或 effect 数
 *   推断。effect 数是**可数事实**，「更贵」是**成本判断**，两者不能混。
 *
 * @see docs/adr/2026-09-14-map-controlled-state.md §6.1 / §6.2
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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
  /**
   * **用户交互 / SDK 回写闭环**（`Map.vue:501` 的 `zoomend` 那条腿）。
   *
   * 关键：真实路径是**SDK 自己先变成 `next`**，事件才触发 `commit(next)`；父级随后按 v-model
   * 写回 `next`，watcher 读回发现 SDK 已经是 `next` ⇒ **0 次额外 SDK 写入**。所以这里必须
   * 先改 `sdkValue` 再 `commit` —— 早先版本只 `commit` 而不动 SDK，等于把「外部 prop 驱动」
   * 当成「用户交互」，会让两条线路**一起模拟错**却仍然互相一致。
   */
  simulateUserZoom(next: number): boolean;
  /** 父级回写受控 `zoom`（`undefined` = 摘掉受控值）。 */
  setZoom(value: number | undefined): Promise<void>;
  /** 父级回写 `defaultZoom`（验证「只在首次解析时读一次」）。 */
  setDefaultZoom(value: number): Promise<void>;
  /** `resetView()`：把内部状态恢复为首次快照（不通知父级）。 */
  reset(): void;
  /** 父级收到的 `update:zoom`。 */
  emitted: number[][];
  /** 本次挂载期间 `devWarn` 输出的告警行。 */
  warnings(): string[];
}

/** 父级同时提供 prop 与 `onUpdate:zoom` —— `useModel` 的 `hasVModel` 判定要求两者都在。 */
function mountRoute(
  route: Route,
  initialProps: { zoom?: number; defaultZoom?: number } = { zoom: 3, defaultZoom: 4 },
): Harness {
  let effects = -1;
  let read: () => number | undefined = () => undefined;
  let sdkWrites = 0;
  let sdkValue = 3;
  const emitted: number[][] = [];
  let commit: (next: number) => boolean = () => false;
  let reset: () => void = () => {};

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
        reset = () => state.reset();
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
        // B：`useModel` + **最小**桥接。父↔子归 Vue（`model` 是**唯一**的父子通道：受控值从
        // `model.value` 读，写回走 `model.value = next` 让 Vue 自己决定「本地更新还是 emit」）。
        // 桥接只留 Vue 覆盖不了的：容差相等（reconcile）、SDK 写入、`reset()`，以及
        // 「记住最后一次外部值」（A3：`useModel` 在受控 prop 被摘掉时读到 `undefined`，
        // 而本库冻结的是「内部接管，保留最后一次外部值」）。
        const model = useModel(childProps, "zoom");
        // 首次解析：受控值 > 非受控初值 > 库默认（与 A 的优先级一致）。**只解析一次**——
        // 这就是 `default*` 只在首次解析时生效的那一半。
        const initial = (model.value as number | undefined) ?? childProps.defaultZoom ?? 4;
        const internal = shallowRef<number>(initial);
        const effective = computed<number | undefined>(() => (model.value as number | undefined) ?? internal.value);
        read = () => effective.value;
        commit = (next) => {
          if (numbersEqual(internal.value, next)) return false;
          internal.value = next;
          // **写通道真的走 useModel**：受控档下 Vue 会 emit，非受控档下 Vue 会本地更新。
          model.value = next;
          return true;
        };
        // `resetView()` 语义：把内部状态恢复为**首次解析**的快照（不通知父级）。
        reset = () => {
          internal.value = initial;
        };
        // 记住「最后外部值」并写 SDK：同一条 watcher 兼两职。`undefined`（受控被摘掉）时
        // **不清 internal** —— 那正是「保留最后一次外部值」的实现点。
        //
        // 冻结契约里的**告警**同样必须实现，否则 A 的第二个 effect（`defaultValue` 告警
        // watcher）就与 B 不可比（复审 P1 指出）。**mode 告警并进这条 watcher**（不新增 effect）：
        // 档位由「上一次是否有受控值」判定，与「有没有真 v-model」无关 —— `hasVModel` 只决定
        // 谁发 emit。`warnOnce` 用一个 Set 去重，对齐 A 的「每种方向最多一次」。
        const warned = new Set<string>();
        const warnOnce = (key: string, message: string): void => {
          if (warned.has(key)) return;
          warned.add(key);
          console.warn(message);
        };
        let wasControlled = model.value !== undefined;
        watch(
          () => model.value,
          (next) => {
            if (next === undefined) {
              if (wasControlled) {
                warnOnce(
                  "to-uncontrolled",
                  "zoom 由受控切换为非受控：内部状态接管，并保留最后一次外部值。受控与非受控请在组件生命周期内保持一致。",
                );
              }
            } else {
              if (!wasControlled && !numbersEqual(next, internal.value)) {
                warnOnce(
                  "to-controlled",
                  "zoom 由非受控切换为受控：当前内部状态与外部值不一致，之后以外部值（及其变化）为准。受控与非受控请在组件生命周期内保持一致。",
                );
              }
              internal.value = next;
            }
            wasControlled = next !== undefined;
            syncSdk(next);
          },
          { flush: "post" },
        );
        // `default*` 的「只在首次解析时生效」告警：`defaultZoom` 的变化**不经过** `model`，
        // 所以没法并进上面那条，只能单独一条 watcher —— **与 A 一样是 1 个**。
        // 这不是 B 独有的额外成本：A 的 `useControllableState` 也是这样一条。
        watch(
          () => childProps.defaultZoom,
          (next, previous) => {
            if (next === undefined && previous === undefined) return;
            if (next !== undefined && previous !== undefined && numbersEqual(next, previous)) return;
            warnOnce(
              "default-ignored",
              "zoom 的 default 值只在首次解析时生效，之后的变化不会覆盖当前状态；若需要持续受控，请改用受控值（组件上即 v-model:zoom）。",
            );
          },
        );
      }

      effects = getCurrentScope()?.effects.length ?? -1;
      return () => h("div");
    },
  });

  // 父级 props 放在一个 ref 里，改它而不是 `wrapper.setProps`（Root 不声明 props，
  // `setProps` 改不到真正传给 Child 的东西）。
  const parentProps = ref<{ zoom?: number; defaultZoom?: number }>({ ...initialProps });

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
  // 冻结契约里的**告警**也是可观察行为（`default*` 后续写入、模式切换），必须一并比对。
  // `logger.warn` 把 context 作为第二参，这里只看首参。
  const warnLines: string[] = [];
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((first: unknown) => {
    warnLines.push(String(first));
  });
  warnSpy.mockClear();

  return {
    effects,
    read,
    sdkRead: () => sdkValue,
    sdkWrites: () => sdkWrites,
    // SDK 先变，事件才触发 commit —— 顺序不能反，否则就不是用户交互了。
    simulateUserZoom: (next) => {
      sdkValue = next;
      return commit(next);
    },
    setZoom: (value) => set("zoom", value),
    setDefaultZoom: (value) => set("defaultZoom", value),
    reset: () => reset(),
    emitted,
    warnings: () => warnLines,
  };
}

describe("#137 Map model prototype（对照读数）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
    // B：useModel 内部 effect + 兼任「记 last外部值 / mode 告警 / 写 SDK」的 watcher
    //    + `default*` 告警 watcher = 3
    // （B 的 `model` 是真实父子通道，删掉它行为断言会红 —— 见文件头与下面的变异说明）
    expect(b, "B：useModel 内部 effect + 桥接 watcher + default 告警 watcher").toBe(3);

    // 结论：**在同等冻结契约下，B 反而多注册 1 个 effect**（3 vs 2）。
    //
    // ⚠️ 这条是「结论 guard」：早先版本 B 没实现告警契约，读数是 2 vs 2，被拿来支撑
    // 「没有更省」—— 那是**拿不同契约作比较**（复审 P1 指出）。补齐告警后 B 变 3。
    // 结论 guard 必须真的挡住「更少」：写成 `a - 1` 会放行 B=1，与文案相反。
    // 读数变了要重审 §6.2 —— 改这一行**并且**改 ADR，不悄悄放宽。
    expect(b, "B 在同等冻结契约下没有比 A 更少 effect").toBeGreaterThan(a);
  });

  it("行为：纯父级受控更新后撤控，两边都保留最后外部值（不经过 commit）", async () => {
    // 这条专治「先 commit 再撤控」把状态写脏的假通过：全程**不调 commit**，只有父级改 prop。
    // A 靠 `syncExternal(8)` 把内部镜像同步成 8；B 靠 `watch(model.value)` 把 8 记进 internal。
    // 撤控后两边都必须是 8，而不是回落到 `defaultZoom`。
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route);
      await h.setZoom(8);
      expect(h.read(), `${route}：父级受控更新应立即生效`).toBe(8);
      await h.setZoom(undefined);
      expect(h.read(), `${route}：撤控后保留最后外部值（不是 defaultZoom）`).toBe(8);
    }
  });

  it("SDK 路径①：纯父级受控更新 3 → 9，恰好下发一次", async () => {
    // 这条是「外部 prop 驱动 SDK」：SDK 还在 3，父级要求 9 ⇒ 恰好补一次 `setZoom(9)`。
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route);
      expect(h.sdkRead(), `${route}：起始 SDK 值`).toBe(3);
      await h.setZoom(9);
      expect(h.sdkWrites(), `${route}：真实父级更新恰好下发一次`).toBe(1);
      expect(h.sdkRead(), `${route}：SDK 收到新值`).toBe(9);
      expect(h.read(), `${route}：受控值生效`).toBe(9);
    }
  });

  it("SDK 路径②：用户交互闭环 0 次额外写入（SDK 先变，事件才触发 commit）", async () => {
    // 真实路径（与 `v3-component-scenarios` 的「用户交互回写 model 并通知父级；父级按 v-model
    // 回写不再写 SDK」同一条）：用户缩放 ⇒ **SDK 自己先变成 9** ⇒ `zoomend` ⇒ `commit(9)` +
    // `update:zoom` ⇒ 父级回写 9 ⇒ watcher 读回发现 SDK 已是 9 ⇒ **0 次额外写入**。
    //
    // 早先版本只 `commit` 而不动模拟 SDK，等于把「外部 prop 驱动」当成「用户交互」，
    // 读数会变成 1 次（还把 SDK 从 3 覆盖回 3）—— 两条线路**一起模拟错**却仍然互相一致。
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route);
      expect(h.simulateUserZoom(9), `${route}：用户交互应当被 commit 接受`).toBe(true);
      expect(h.emitted, `${route}：应通知父级一次`).toEqual([[9]]);
      await h.setZoom(9);
      expect(h.sdkWrites(), `${route}：回写自身不得触发新的 SDK 写入`).toBe(0);
      expect(h.read(), `${route}：受控值生效`).toBe(9);
    }
  });

  it("冻结契约：`default*` 后续写入不覆盖，且告警恰好一次", async () => {
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route, { zoom: undefined }); // 非受控挂载：`defaultZoom` 是当前值来源
      expect(h.read(), `${route}：非受控下用 defaultZoom`).toBe(4);
      await h.setDefaultZoom(5);
      expect(h.read(), `${route}：default 变化不覆盖当前状态`).toBe(4);
      expect(
        h.warnings().filter((line) => line.includes("default")).length,
        `${route}：default 后续写入应告警恰好一次`,
      ).toBe(1);
    }
  });

  it("冻结契约：受控 ↔ 非受控切换的告警语义与 A 一致", async () => {
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route);
      // 受控 → 非受控：告警一次。
      await h.setZoom(undefined);
      expect(
        h.warnings().filter((line) => line.includes("由受控切换为非受控")).length,
        `${route}：受控→非受控应告警恰好一次`,
      ).toBe(1);
      // 再切回受控：撤控时内部接管的值是「最后外部值 3」，所以传 3 不冲突（按规则不告警）。
      const before = h.warnings().length;
      await h.setZoom(3);
      expect(
        h.warnings().length,
        `${route}：值不冲突的切回受控不该新增告警`,
      ).toBe(before);
      // 传一个**冲突**的值（8 ≠ 内部 3）：此时才告警，且恰好一次。
      await h.setZoom(undefined);
      await h.setZoom(8);
      expect(
        h.warnings().filter((line) => line.includes("由非受控切换为受控")).length,
        `${route}：非受控→受控且值冲突应告警恰好一次`,
      ).toBe(1);
    }
  });

  it("冻结契约：reset() 把内部状态恢复为首次快照（`resetView()` 语义）", async () => {
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route, { zoom: undefined }); // 非受控挂载，首次快照 = defaultZoom = 4
      expect(h.read(), `${route}：reset 前`).toBe(4);
      h.simulateUserZoom(11);
      expect(h.read(), `${route}：用户交互到新值`).toBe(11);
      h.reset();
      expect(h.read(), `${route}：reset 后回到首次快照`).toBe(4);
      // reset 后再交互到**旧值**必须仍然被当作真变化（否则真实操作会被判成「没变化」）。
      expect(h.simulateUserZoom(11), `${route}：reset 后再次交互到旧值仍算变化`).toBe(true);
      expect(h.read(), `${route}：再次交互生效`).toBe(11);
    }
  });

  it("行为：B 与 A 逐项同构（受控抖动、真实变化、default 只读一次）", async () => {
    for (const route of ["A", "B"] as const) {
      const h = mountRoute(route);

      // ① 容差内的抖动：两边都**不**下发 SDK、**不**通知父级。
      await h.setZoom(3 + NUMBER_EPSILON / 2);
      expect(h.sdkWrites(), `${route}：容差内抖动不该下发`).toBe(0);
      expect(h.emitted, `${route}：容差内抖动不该通知父级`).toEqual([]);

      // ② 真实变化。
      await h.setZoom(9);
      expect(h.sdkWrites(), `${route}：真实变化恰好下发一次`).toBe(1);
      expect(h.read(), `${route}：受控值生效`).toBe(9);

      // ③ `defaultZoom` 之后变化**不**覆盖当前状态（只在首次解析时读一次）。
      await h.setDefaultZoom(15);
      expect(h.read(), `${route}：default 变化不覆盖`).toBe(9);
    }
  });
});
