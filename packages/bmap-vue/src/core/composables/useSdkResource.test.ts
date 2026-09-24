import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, ref, watch } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useSdkResource, type SdkResourceSpec } from "./useSdkResource";
import { createHandle, type SdkHandle } from "../../driver/types/handles";
import { BMapError } from "../errors/BMapError";

type Res = SdkHandle<"overlay:test", { id: number }>;
type Ctx = { name: string };

function spec(opts: { failCreate?: boolean } = {}): SdkResourceSpec<{ v: number }, Res, Ctx> {
  return {
    type: "test-overlay",
    create: ({ context, props }) => {
      if (opts.failCreate) throw new Error("create boom");
      return createHandle("overlay:test", { id: props.v }) as unknown as Res;
    },
    mount: ({ resource, scope }) => {
      let disposed = false;
      const dispose = vi.fn(() => {
        disposed = true;
      });
      scope.add(dispose);
      return { id: Symbol("reg"), type: "test-overlay", resource, get disposed() { return disposed; }, dispose };
    },
  };
}

describe("useSdkResource", () => {
  it("[#139] spec.watch 建的 watcher 归 Vue 所有：挂载中会触发，卸载后**不再**触发", async () => {
    // 这条钉住「effect 生命周期交回 Vue」这条**验收项**：`spec.watch` 建的 watcher 在组件卸载时
    // 必须停掉。它真正能抓住的回归是「`spec.watch` 被挪进 async 钩子」——那时 watcher 逃出组件的
    // effect scope（`getCurrentScope()` 为 null），Vue 不会停它，实测这条会翻红。
    //
    // 它**抓不到**「把 `scope.add(watch(...))` 加回来」：那份包装在卸载时同样会停（`componentScope`
    // 自己在 `onUnmounted` 里 dispose），属于冗余但无害。删掉它的理由是「谁负责停它」不该有两个
    // 答案 + 资源账本不该为 Vue 已有的东西计费，不是因为它会漏——这里如实说明，免得下一个维护者
    // 以为这条断言比实际更强。
    //
    // 观察源用**组件外部的 ref**而不是 props：卸载之后组件实例已经不在树上，改 props 不会
    // 触发任何东西，那样的断言是恒真的。外部 ref 才能真正回答「watcher 还活着吗」。
    const source = ref(1);
    const onSource = vi.fn();
    const Comp = defineComponent({
      setup() {
        useSdkResource({
          props: { v: 1 },
          spec: {
            ...spec(),
            watch: () => {
              watch(source, (next) => onSource(next), { flush: "sync" });
            },
          },
          resolveContext: async () => ({ name: "ctx" }),
        });
        return () => h("div");
      },
    });

    const wrapper = mount(Comp);
    await flushPromises();
    source.value = 2;
    expect(onSource, "挂载中 watcher 正常触发").toHaveBeenCalledWith(2);

    wrapper.unmount();
    source.value = 3;
    expect(onSource, "卸载后 Vue 已经停掉它").toHaveBeenCalledTimes(1);
  });

  it("creates on mount and exposes ready status", async () => {
    let seen: ReturnType<typeof useSdkResource<{ v: number }, Res, Ctx>> | null = null;
    const Comp = defineComponent({
      setup() {
        seen = useSdkResource({
          props: { v: 1 },
          spec: spec(),
          resolveContext: async () => ({ name: "ctx" }),
        });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    await flushPromises();
    expect(seen!.status.value).toBe("ready");
    expect(seen!.resource.value).toBeTruthy();
    await expect(seen!.whenReady()).resolves.toBe(seen!.resource.value);
    wrapper.unmount();
    expect(seen!.status.value).toBe("disposed");
  });

  it("does not create when unmounted before context resolves", async () => {
    const create = vi.fn(async () => createHandle("overlay:test", { id: 1 }) as unknown as Res);
    const Comp = defineComponent({
      setup() {
        useSdkResource({
          props: { v: 1 },
          spec: { type: "t", create, mount: () => {} },
          resolveContext: async (signal) => {
            await new Promise((r) => setTimeout(r, 20));
            void signal;
            return { name: "c" };
          },
        });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    wrapper.unmount();
    await new Promise((r) => setTimeout(r, 40));
    expect(create).not.toHaveBeenCalled();
  });

  it("replace destroys the old child scope and instance", async () => {
    let seen: ReturnType<typeof useSdkResource<{ v: number }, Res, Ctx>> | null = null;
    const disposed: number[] = [];
    let n = 0;
    const Comp = defineComponent({
      setup() {
        seen = useSdkResource({
          props: { v: 1 },
          spec: {
            type: "t",
            create: ({ props }) => {
              n++;
              return createHandle("overlay:test", { id: (props as { v: number }).v * 10 + n }) as unknown as Res;
            },
            mount: ({ resource, scope }) => {
              const raw = resource as Res;
              scope.add(() => disposed.push((raw.raw as { id: number }).id));
              return { id: Symbol("r"), type: "t", resource, disposed: false, dispose: () => disposed.push(-1) };
            },
          },
          resolveContext: async () => ({ name: "c" }),
        });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    await flushPromises();
    const first = seen!.resource.value;
    await seen!.replace();
    await flushPromises();
    expect(seen!.resource.value).not.toBe(first);
    // 旧 child scope 已销毁(旧实例 disposer 执行)
    expect(disposed.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("whenReady is a function (no unhandled rejected promise on return)", async () => {
    const Comp = defineComponent({
      setup() {
        const r = useSdkResource({
          props: { v: 1 },
          spec: spec({ failCreate: true }),
          resolveContext: async () => ({ name: "c" }),
          onError: () => {},
        });
        // 返回值中不应有裸 ready Promise 属性
        expect((r as unknown as { ready?: unknown }).ready).toBeUndefined();
        expect(typeof r.whenReady).toBe("function");
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    await flushPromises();
    wrapper.unmount();
  });

  it("surfaces create errors via status/error", async () => {
    let seen: ReturnType<typeof useSdkResource<{ v: number }, Res, Ctx>> | null = null;
    const onError = vi.fn();
    const Comp = defineComponent({
      setup() {
        seen = useSdkResource({
          props: { v: 1 },
          spec: spec({ failCreate: true }),
          resolveContext: async () => ({ name: "c" }),
          onError,
        });
        return () => h("div");
      },
    });
    const wrapper = mount(Comp);
    await flushPromises();
    expect(seen!.status.value).toBe("error");
    expect(seen!.error.value).toBeInstanceOf(BMapError);
    expect(onError).toHaveBeenCalledTimes(1);
    await expect(seen!.whenReady()).rejects.toBeInstanceOf(BMapError);
    wrapper.unmount();
  });
});
