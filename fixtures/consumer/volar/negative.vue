<template>
  <!--
    反证（issue #158 工作包 C）：模板同样**没有任何本地 import**，必须产生两类**精确**诊断。

    - `:zoom="'12'"`：`zoom` 是已知 prop 且类型是 `number` ⇒ TS2322。
      刻意不用「未知 HTML attribute」当反例 —— 它可能合法落进 `attrs` 而不报错。
    - `#default="{ totallyNotARealMember }"`：slot 载荷有具名成员、**没有字符串索引签名**
      ⇒ TS2339。

    两类诊断能出现，就证明 `GlobalComponents` 生效、且 props / slots 没有退化成 `any`
    （退化成 any 时两者都不会报错）。实测：把 `types` 里的 `…/volar` 去掉，这份文件零诊断。
  -->
  <Map :zoom="'12'" :center="{ lng: 116.4, lat: 39.9 }">
    <template #default="{ totallyNotARealMember }">
      <span>{{ totallyNotARealMember }}</span>
    </template>
  </Map>
</template>
