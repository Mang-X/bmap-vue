<template>
  <!--
    反证（issue #158 工作包 C）：模板同样**没有任何本地 import**，必须产生两类**精确**诊断。

    - `:keep-alive-behavior="'definitely-not-a-real-mode'"` ⇒ TS2322。用这个 prop 是因为它的
      类型是**字面量联合** `"suspend" | "dispose"`，诊断消息里会带上那个唯一的 sentinel
      （`Type '"definitely-not-a-real-mode"' is not assignable …`），于是断言锚定到**这一条**
      prop 反证上，而不是「文件里存在某个 TS2322」。
      刻意不用 `:zoom="'12'"`：它的消息只带 `number`，别的表达式也能产生同样的 TS2322。
      也刻意不用「未知 HTML attribute」——那种写法可能合法落进 `attrs` 而不报错。
    - `#default="{ totallyNotARealMember }"` ⇒ TS2339：slot 载荷有具名成员、**没有字符串索引
      签名**，成员名同样作为 sentinel 被断言锚定。

    两类诊断能出现，就证明 `GlobalComponents` 生效、且 props / slots 没有退化成 `any`
    （退化成 any 时两者都不会报错）。实测：把 `types` 里的 `…/volar` 去掉，这份文件零诊断。
  -->
  <Map :keep-alive-behavior="'definitely-not-a-real-mode'">
    <template #default="{ totallyNotARealMember }">
      <span>{{ totallyNotARealMember }}</span>
    </template>
  </Map>
</template>
