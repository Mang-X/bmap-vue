## API Signature Baseline for "bmap-vue" (entry `./resolver`)

> 由 `pnpm generate:api` 生成，请勿手工编辑。
> 内容是 `dist/resolver.d.ts` 经 TypeScript printer（`removeComments: true`）规范化后的全文。
> 这个出口同时有 API report 与 forgotten-export 身份集合；本快照是第三层：
> report 对未导出类型只留 `typeof getXxx` 名字引用、集合只记符号名，
> **同名结构**的漂移只有这里看得见（ADR 2026-09-25 决策 5 / #159 三轮评审 P1）。

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
