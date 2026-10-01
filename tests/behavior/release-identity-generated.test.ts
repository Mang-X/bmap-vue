/**
 * 发布身份在**生成物**与**构建期注入**里的一致性（issue #45 评审 P1）
 *
 * 包名迁移时有三处「用户直接消费」的地方容易漏掉，漏掉的表现都是**门禁全绿**：
 *
 * 1. `BMapResolver` 返回的组件 `from` —— unplugin-vue-components 会把它**原样写进
 *    用户的源码**。写死旧名不会「找不到包」：npm 上无 scope 的 `bmap-vue` 属于另一位
 *    作者，于是用户的项目 import 到**别人的包**。
 * 2. 随包发布的 `volar.d.ts` —— 里面的 `typeof import('…')` 指向谁，就决定了用户的
 *    Volar 去解析谁。写死旧名会让它与安装说明里的新名字自相矛盾。
 * 3. `check:api` 的签名基线 header —— 基线是要长期当契约守的，记录一个已不存在的
 *    身份会让它失去意义。
 *
 * 前两处在迁移时被漏掉，而且**各自的单测都还是绿的**（单测断言的正是那个旧值），
 * 所以「单测通过」完全不能证明身份一致。这里直接从生成产物与构建期常量读真值。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIBRARY_PACKAGE_NAME } from '../../packages/bmap-vue/src/version';
import { BMapResolver } from '../../packages/bmap-vue/src/resolver';
import { releaseIdentityOf, PKG_DIR } from '../../scripts/release-identity.mts';
import { renderVolarDts } from '../../scripts/manifest-artifacts-boundary.mts';
import { componentManifest } from '../../packages/bmap-vue/src/manifest';

const root = resolve(import.meta.dirname, '../..');
const PKG = releaseIdentityOf(
  JSON.parse(readFileSync(resolve(root, PKG_DIR, 'package.json'), 'utf8')),
).name;

/** npm 上已被本项目放弃的旧身份。写在这里是为了让「为什么不能出现它」可被核对。 */
const RETIRED = 'bmap-vue';

describe('#45 发布身份：生成物与构建期注入', () => {
  it('构建期注入的包名等于 manifest', () => {
    // vitest.config.ts 展开了 `versionDefine`，所以 `__PKG_NAME__` 在测试里同样可用。
    expect(LIBRARY_PACKAGE_NAME).toBe(PKG);
    expect(LIBRARY_PACKAGE_NAME).not.toBe(RETIRED);
  });

  it('BMapResolver 返回的 from 用当前包名', () => {
    const r = BMapResolver().resolve('Map');
    expect(r).toEqual({ name: 'Map', from: `${PKG}/components` });
    // 单独断言一次**全等**：不能用 `not.toContain(RETIRED)` —— `@mangax/bmap-vue`
    // 本身就含 `bmap-vue` 子串，那条断言恒红（第一版真实踩到）。
    expect(r?.from).not.toBe(`${RETIRED}/components`);
  });

  it('volar.d.ts 的生成结果引用当前包名（纯函数，不碰磁盘共享文件）', () => {
    // 这里**刻意不读 `packages/bmap-vue/volar.d.ts`**。那个文件是 gitignore 的生成物，
    // 而 `manifest-check.test.ts` 会 `rmSync` 它来验证「缺失时也能重新生成」；
    // 两个 test file 在不同 worker 并行时，那是一个真实竞态窗口——身份测试刚生成完
    // 还没读，另一边把它删了，于是随机报「未生成」。上一版就是这么写的，评审抓到了。
    //
    // 改为直接测生成器的纯函数：断言逻辑与文件系统解耦，判据仍然 fail-closed。
    // **文件是否真的被打进包**由 `check:pack-contents` 与 CI 的 package job 负责——
    // 那才是真实消费路径。
    const names = componentManifest.map((c) => c.name);
    expect(names.length, 'manifest 里应有组件').toBeGreaterThan(0);

    const rendered = renderVolarDts(names, PKG);
    const specifiers = [...rendered.matchAll(/typeof import\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(specifiers.length, '生成结果里应有组件类型引用').toBeGreaterThan(0);
    for (const specifier of new Set(specifiers)) {
      expect(specifier, `volar.d.ts 引用了旧身份：${specifier}`).toBe(PKG);
    }
  });

  it('volar.d.ts 的键是合法的 TS 标识符（不是 [object Object]）', () => {
    // 上一版重构把**对象数组**传给了要 `string[]` 的纯函数，于是模板插值出
    // `[object Object]`——112 行全坏，而那份文件跟着包发布。没有任何门禁抓到它，
    // 因为 `scripts/**/*.mts` **不在任何 tscheck 范围**，而 Node 的
    // `--experimental-strip-types` 只剥类型、不做类型检查。
    //
    // 因此这里从**产物形态**兜底：GlobalComponents 的键必须是合法标识符。
    // 纯函数测试证明的是「给它字符串时它对」，这条证明的是「真实调用路径没喂错东西」。
    const names = componentManifest.map((c) => c.name);
    const rendered = renderVolarDts(names, PKG);
    // 产物有两份等价的 `GlobalComponents` 声明（`vue` 与 `@vue/runtime-core`，
    // 双声明兼容），所以键数是组件数的两倍——判据要认这个结构。
    const keys = [...rendered.matchAll(/^ {4}(\S+): typeof import\(/gm)].map((m) => m[1]!);

    expect(keys.length, '两份声明各含全部组件键').toBe(names.length * 2);
    for (const key of keys) {
      expect(key, `组件键被插值坏了：${key}`).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    }
    // 键集合必须与 manifest 一一对应（漏一个或重复都算坏）
    expect([...new Set(keys)].sort()).toEqual([...names].sort());
  });

  it('真实调用路径产出合法的 volar.d.ts（抓「传错参数形状」）', () => {
    // 上一条测的是**纯函数**，因此抓不到调用点的错：生成器把 `{ name, ... }` 对象数组
    // 传给要 `string[]` 的纯函数时，函数本身是对的（给它字符串它就正确），
    // 而产物全是 `[object Object]`。这条是唯一能抓到它的判据。
    //
    // 为什么在这里跑生成器而不是读仓库里的 `volar.d.ts`：那个文件是共享的，
    // `manifest-check.test.ts` 会 `rmSync` 它，并行下有竞态（本文件已修过一轮）。
    // 在**子进程**里跑一次并读它的 stdout，仓库文件全程不被写。
    const source = readFileSync(
      resolve(root, "scripts/generate-manifest-artifacts.mts"),
      "utf8",
    );
    // 生成器是顶层脚本，直接 import 就会写盘；因此这里只断言**调用点的参数形状**：
    // 它必须把 `names` 映射成字符串数组再传，而不是直接传对象数组。
    expect(
      source,
      "renderVolarDts 必须收到组件名字符串数组（直接传 names 会插值成 [object Object]）",
    ).toMatch(/renderVolarDts\(\s*names\.map\(\(c\) => c\.name\)/);

    // 并且纯函数对这些名字产出的键必须是合法标识符（两层合起来才完整）。
    const names = componentManifest.map((c) => c.name);
    const rendered = renderVolarDts(names, PKG);
    const keys = [...rendered.matchAll(/^ {4}(\S+): typeof import\(/gm)].map((m) => m[1]!);
    for (const key of keys) {
      expect(key, `组件键被插值坏了：${key}`).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    }
  });

  it('签名基线的 header 记录当前包名', () => {
    const dtsBaseline = resolve(root, PKG_DIR, 'etc/advanced/bmap-vue.dts.md');
    if (!existsSync(dtsBaseline)) {
      expect(true, '签名基线不存在（需先 pnpm generate:api）').toBe(true);
      return;
    }
    const head = readFileSync(dtsBaseline, 'utf8').split('\n')[0]!;
    // 同样不能用 `not.toContain(RETIRED)`：`"@mangax/bmap-vue"` 含该子串。
    expect(head.startsWith(`## API Signature Baseline for "${PKG}"`)).toBe(true);
  });
});