## API Signature Baseline for "bmap-vue" (entry `./resolver`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/resolver.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> API Extractor 分析不了这两个出口的 Volar `__VLS_` 悬空引用，
> 但它们的类型面仍必须有一份会变红的基线（ADR 2026-09-25 决策 5 / #159 评审 P1-1）。

```ts
export declare function BMapResolver(): ComponentResolverLike;
export declare interface ComponentResolverLike {
    type?: "component" | "directive";
    resolve: (name: string) => {
        name: string;
        from: string;
    } | undefined | void;
}
export {};
```
