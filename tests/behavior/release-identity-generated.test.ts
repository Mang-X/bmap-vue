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

  it('随包发布的 volar.d.ts 引用当前包名', () => {
    const volar = resolve(root, PKG_DIR, 'volar.d.ts');
    // 该文件是 gitignore 的生成产物；`check:pack-contents` 保证真正发布时它一定存在。
    // 这里在它缺失时跳过，避免让「本机没跑生成器」变成一条红。
    if (!existsSync(volar)) {
      expect(true, 'volar.d.ts 未生成（跑 pnpm generate:manifest）').toBe(true);
      return;
    }
    const source = readFileSync(volar, 'utf8');
    const imports = [...source.matchAll(/typeof import\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(imports.length, 'volar.d.ts 里应当有组件类型引用').toBeGreaterThan(0);
    for (const specifier of new Set(imports)) {
      expect(specifier, `volar.d.ts 引用了旧身份：${specifier}`).toBe(PKG);
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