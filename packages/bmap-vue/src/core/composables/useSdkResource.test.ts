import { describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
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
