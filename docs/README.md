# Documentation Site

The documentation site is built with VitePress and uses Vite+ (`vp`) for local tasks.

## Commands

Run these commands from the repository root:

```sh
pnpm docs:dev
pnpm docs:build
pnpm docs:check
pnpm docs:typecheck
pnpm check:docs-brand   # retired release identity must not reappear on the published surface
pnpm check:docs-links   # anchors and nav coverage (page-level dead links are vitepress build's job)
```

Run them from this directory when working only on the documentation site:

```sh
pnpm dev
pnpm build
pnpm check
pnpm typecheck
```

`format` uses Oxfmt through Vite+. Markdown files are excluded because their formatting is controlled by the documentation authoring conventions and VitePress rendering.

## How examples are typechecked

`docs/examples/**` is a **consumer**, not source. `docs/tsconfig.json` maps
`bmap-vue` to `../packages/bmap-vue/dist/index.d.ts`, so `pnpm docs:typecheck`
compiles the examples against the **published declaration surface** — an example
cannot use an API that exists in source but is absent from `dist`.

That means the build order matters: run `pnpm build:package` before
`pnpm docs:typecheck`, or you get a false "cannot find dist/*.d.ts" failure. CI
does this in the `docs` job.

There was once a root `tsconfig.examples.json` for this, but no script or CI job
ever compiled it and its `paths` pointed at `src/` rather than `dist/`. It was
removed rather than wired up, since `docs:typecheck` already covers the examples
against the correct target.

Runtime and dev differ on purpose: `docs/vite.config.ts` aliases `bmap-vue` to
source for hot reload, while typechecking stays on `dist`.

## Project history

This site documents `bmap-vue`, which continues
[yue1123/vue3-baidu-map-gl](https://github.com/yue1123/vue3-baidu-map-gl). See
[NOTICE.md](https://github.com/Mang-X/bmap-vue/blob/main/NOTICE.md) and
[LICENSE](https://github.com/Mang-X/bmap-vue/blob/main/LICENSE) for the full
attribution. (Both live at the repository root, outside the site root, so they
are linked absolutely rather than relatively — VitePress rejects links that
escape `docs/`.)
