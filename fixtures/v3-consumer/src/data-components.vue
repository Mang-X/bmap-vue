<!--
  数据组件（M6 / #34）的**模板侧**类型 smoke。

  这一份存在的唯一理由：`Item` 必须从 `data` 推断出来，而不是退化成 `unknown` / `any`。
  三种退化各有一道断言：

  ① `getPosition` 的内联参数：`Item = unknown` 时 `item.lng` 直接报错；
  ② `@item-click` 绑定的处理器写成 `(item: Station) => void`：`Item = unknown` 时因**逆变**而失败；
  ③ 载荷字段：`@ts-expect-error` 是双向的 —— `Item` 退化成 `any` 时它会变成「多余的指令」。
-->
<script setup lang="ts">
import { BMarkerCluster, BMarkerList, BPointCollection, type BMapPointPick } from 'baidu-map-gl-vue'

interface Station {
  id: string
  lng: number
  lat: number
  name?: string
}

const stations: Station[] = [
  { id: 'a', lng: 116.404, lat: 39.915, name: '百度大厦' },
  { id: 'b', lng: 116.41, lat: 39.92 },
]

function onItemClick(item: Station): void {
  // ③ 载荷字段是具体的（`string | undefined`），不是 `any`
  // @ts-expect-error `name` 不是 number
  const notANumber: number = item.name
  void notANumber
}

function onPick(pick: BMapPointPick<Station>): void {
  const item: Station | null = pick.item
  void item
}
</script>

<template>
  <!-- ② 逆变门：处理器参数类型写死为 Station；推断成 unknown / any 都会失败 -->
  <BMarkerList
    :data="stations"
    item-key="id"
    :get-position="(item) => ({ lng: item.lng, lat: item.lat })"
    @item-click="onItemClick"
  />
  <BMarkerCluster
    :data="stations"
    :item-key="(item) => item.id"
    :get-position="(item) => ({ lng: item.lng, lat: item.lat })"
    @item-click="onItemClick"
    @cluster-click="(cluster) => void (cluster.points[0] as Station | undefined)"
  />
  <BPointCollection
    :data="stations"
    item-key="id"
    :get-position="(item) => ({ lng: item.lng, lat: item.lat })"
    :properties="(item) => ({ name: item.name ?? '未命名' })"
    :shape="0"
    :size="18"
    color="#1677ff"
    @item-click="onItemClick"
    @click="onPick"
  />
</template>
