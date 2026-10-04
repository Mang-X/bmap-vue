/**
 * `useControllableState` 与 Vue 3.5 `useModel` 的**能力对照**（issue #137）
 *
 * ## 这份文件是什么、不是什么
 *
 * **是**：#137「为什么 `<Map>` 的视野模型不迁到 `defineModel` / `useModel`」的**可复核依据**。
 * ADR `2026-09-14-map-controlled-state` §6.1 把结论写成了断言；这里把断言变成会翻红的用例。
 * 没有它，那个结论只能靠「作者读过 Vue 源码」支撑，下一个读者无法区分「试过」与「以为如此」。
 *
 * **不是**对 `useControllableState` 的重复测试（那些在 `useControllableState.test.ts`）。
 * 这里**只测 Vue 那一侧**，断言的是**上游框架的行为** —— 所以断言写的是 `useModel` 的形状，
 * 而不是本库 helper 的形状。
 *
 * ## 为什么必须是常驻用例而不是一次性探针
 *
 * 这份对照的**前提**是「Vue 的 `useModel` 表达不了本库冻结的语义」。Vue 升级后如果它补上了
 * （例如给受控 prop 撤回提供了「保留最后值」），本文件会**变红**，届时 #137 的结论与 ADR §6.1
 * 必须重审。这正是把它放进 CI 的理由 —— 与 `scripts/probe-*.mts` 那批「打真实 SDK」的探针不同，
 * 本对照**无网络、无凭据**，是纯 Vue 断言。
 *
 * ## 五条断言各自锁住什么
 *
 * | # | 断言 | 在 #137 结论里的作用 |
 * | --- | --- | --- |
 * | A1 | 无 `v-model` 时写 `useModel` **本地生效** | 非受控档：事实源是本地状态（**这一条两边一致**） |
 * | A2 | 有 `v-model` 时写只 emit、值等父级回写 | 受控档「prop 优先」（**这一条两边一致**） |
 * | A3 | **受控 prop 被摘掉后读到 `undefined`** | 钉**能力事实**：**`useModel` 本身不保存最后一次外部值** ⇒ 维持冻结语义「受控 → 非受控保留最后外部值」**必须有独立的 bridge state**。**不下迁移结论**——迁移与否见 `mapModel.prototype.test.ts` 的完整原型（那里的限制不止这一处） |
 * | A4 | 写「**数值不同但在本库容差内**」的值**仍 emit** | 它是精确变化比较 ⇒ **没有容差相等**，而本库四个视野字段全部依赖容差（否则受控写入与 SDK 读回会形成往返） |
 * | A5 | `string \| Point` 联合 prop 在 `useModel` 上**可用** | 把「不迁移」的原因锁定在**语义**而非**类型**上，避免以后被误诊为类型不兼容 |
 */
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref, useModel } from "vue";
import { mount } from "@vue/test-utils";
import { NUMBER_EPSILON, numbersEqual } from "../core/utils/equality";

/**
 * 挂一个最小 `<Child>`，把 `useModel` 句柄、父级改 props 的能力与 emit 日志交出去。
 *
 * `onUpdate:modelValue` **刻意不自动回写父级 state** —— 真实 `v-model` 会回写，而这里要看的是
 * 「emit 出去、但父级还没回写」这个中间态，那正是受控档的语义。
 */
async function withModel(
  initialProps: Record<string, unknown>,
  body: (ctx: {
    model: { value: unknown };
    setProps: (next: Record<string, unknown>) => Promise<void>;
    emitted: unknown[][];
  }) => Promise<void>,
): Promise<void> {
  const props = ref<Record<string, unknown>>(initialProps);
  const emitted: unknown[][] = [];
  let model: { value: unknown } | null = null;

  const Child = defineComponent({
    props: { modelValue: { type: Number, required: false } },
    emits: { "update:modelValue": (_v: number) => true },
    setup(childProps) {
      model = useModel(childProps, "modelValue");
      return () => h("div", String((model as { value: unknown }).value));
    },
  });

  const Root = defineComponent({
    setup: () => () =>
      h(Child, {
        ...props.value,
        // `useModel` 判定「父级传了 v-model」的条件是：prop 与 `onUpdate:<name>` **同时**出现在
        // `i.vnode.props` 里（见 runtime-core 的 `hasVModel`）。这个 key 必须逐字是
        // `onUpdate:modelValue` —— 写成 `onUpdateModelValue`（Vue 模板编译器的 kebab/camel 变体）
        // **不算**，那样 useModel 会走非受控分支，测到的就全是另一条路径。
        "onUpdate:modelValue": (v: number) => {
          emitted.push([v]);
        },
      }),
  });

  const wrapper = mount(Root);
  await nextTick();

  await body({
    model: model as unknown as { value: unknown },
    setProps: async (next) => {
      // 改的是 Root **渲染时展开的那个 ref**，不是 wrapper 自己的 props（Root 不声明 props，
      // `wrapper.setProps` 改不到真正传给 Child 的东西）。
      props.value = next;
      await nextTick();
    },
    emitted,
  });
  wrapper.unmount();
}

describe("对照 `useModel`（#137：不迁移的依据）", () => {
  it("A1 非受控档：写本地生效（与本库语义一致）", async () => {
    await withModel({}, async ({ model, emitted }) => {
      model.value = 9;
      await nextTick();
      // 事实源落在本地：没有 v-model 时写 `useModel` 会立刻改变自己的值。
      // （它**仍会** emit 一次 `update:modelValue` —— 这是 Vue 的固定行为，不影响
      // 「本地为源」这个结论，所以这里只断言本地生效，不断言「不 emit」。）
      expect(model.value).toBe(9);
      expect(emitted).toEqual([[9]]);
    });
  });

  it("A2 受控档：写只 emit、值停在 prop 上等父级回写（与本库语义一致）", async () => {
    await withModel({ modelValue: 3 }, async ({ model, emitted }) => {
      model.value = 7;
      await nextTick();
      expect(model.value, "父级没回写之前，值必须仍是 prop 上的 3").toBe(3);
      expect(emitted).toEqual([[7]]);
    });
  });

  it("A3 受控 prop 被摘掉后 useModel 读到 undefined ⇒ 维持冻结语义必须补 bridge state", async () => {
    await withModel({ modelValue: 7 }, async ({ model, setProps }) => {
      await setProps({});
      // 本库 ADR 决策 4 §3 冻结的语义：受控 → 非受控时**内部状态接管，保留最后一次外部值**。
      // useModel 给出的是 undefined ⇒ 它**自己不保存**最后一次外部值（undefined 是它表达
      //「现在没有受控值」的信号），所以要维持这条契约**必须额外补 bridge state**。
      //
      // ⚠️ 这条只钉**能力事实**，不下迁移结论。是否迁移由 `mapModel.prototype.test.ts` 的
      //    完整原型决定：那里 `useModel` 的限制不止这一处（真实非受控用法下读 / 档位判定 /
      //    reset 边界的 emit 都会出问题），且**把 `useModel` 整个去掉后行为用例仍全过** ——
      //    即它换不到任何可观察行为。迁移与否按那份原型读，不按本条。
      expect(model.value, "useModel 不保存最后一次外部值").toBeUndefined();
    });
  });

  it("A4 写「本库容差内但数值不同」的值仍 emit：证明它是精确变化比较，不是容差相等", async () => {
    // 判别力说明：初值取 3，写入 `3 + NUMBER_EPSILON / 2`。
    //
    //   - 本库 `numbersEqual(3, 3 + 5e-7)` 为 **true**（差值 5e-7 ≤ 容差 1e-6）⇒
    //     `useControllableState` 会判「没变化」，**不写内部状态、不通知父级**；
    //   - `useModel` 若只有精确比较（`hasChanged`），这次写入**必须 emit**。
    //
    // 早先这条写的是「写完全相同的 3 ⇒ 不 emit」—— 那个输入没有判别力：严格相等、
    // `Object.is`、乃至任何容差相等都会让它通过，撑不起「没有容差相等」的结论。
    // 用「数值不同但在本库容差内」的值，两种语义才会分道扬镳。
    const WITHIN_LIBRARY_TOLERANCE = 3 + NUMBER_EPSILON / 2;
    await withModel({ modelValue: 3 }, async ({ model, emitted }) => {
      // 正证守卫：这个差值在本库的容差相等口径下**确实相等**——否则下面的断言
      // 可能只是因为「差值太大、两边都判不等」而通过，判别力又没了。
      expect(
        numbersEqual(3, WITHIN_LIBRARY_TOLERANCE),
        "守卫：这个差值必须落在本库容差内，否则本用例测不到容差语义",
      ).toBe(true);
      expect(WITHIN_LIBRARY_TOLERANCE, "守卫：且它在数值上确实不等于初值").not.toBe(3);

      model.value = WITHIN_LIBRARY_TOLERANCE;
      await nextTick();

      // ⇒ 结论：useModel 把这次写入当成「变了」，而本库会当成「没变」。
      // 这正是四个视野字段必须自带容差相等的原因（否则受控写入与 SDK 读回
      // 会形成「每次都判定为变化」的往返）。若上游将来给 useModel 补上容差相等，
      // 本条会翻红。
      expect(emitted, "容差内的抖动被 useModel 当成真实变化").toEqual([[WITHIN_LIBRARY_TOLERANCE]]);
    });
  });

  it("A5 string | Point 联合 prop 在 useModel 上可用 ⇒ 障碍是语义不是类型", async () => {
    let model: { value: unknown } | null = null;
    const Union = defineComponent({
      props: { center: { type: [String, Object] as unknown as () => unknown, required: false } },
      emits: { "update:center": (_v: unknown) => true },
      setup(childProps) {
        model = useModel(childProps, "center");
        return () => h("div");
      },
    });

    const wrapper = mount(Union, { props: { center: "北京市" } });
    await nextTick();
    expect((model as unknown as { value: unknown }).value).toBe("北京市");

    (model as unknown as { value: unknown }).value = { lng: 1, lat: 2 };
    await nextTick();
    expect(wrapper.emitted("update:center")).toEqual([[{ lng: 1, lat: 2 }]]);
    wrapper.unmount();
  });
});
