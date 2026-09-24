<!--
  数据组件（M6 / #34、#35）的**模板侧**类型 smoke。

  这一份存在的唯一理由：`Item` 必须从 `data` 推断出来，而不是退化成 `unknown` / `any`。
  三种退化各有一道断言：

  ① `getPosition` 的内联参数：`Item = unknown` 时 `item.lng` 直接报错；
  ② `@item-click` 绑定的处理器写成 `(item: Station) => void`：`Item = unknown` 时因**逆变**而失败；
  ③ 载荷字段：`@ts-expect-error` 是双向的 —— `Item` 退化成 `any` 时它会变成「多余的指令」。

  #35 补进来的三个组件（图标层、扩展 API 点层、原生聚合的载荷）走同一条门：`Item` 从 `data`
  推断、`cluster-click` 的 `items` 在类型上是 `Station[] | null`（不是 `any`）。
-->
<script setup lang="ts">
import {
  MarkerCluster,
  MarkerList,
  PointIconLayer,
  PointLayer,
  PointCollection,
  type ClusterPick,
  type PointPick,
} from 'bmap-vue'

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

function onPick(pick: PointPick<Station>): void {
  const item: Station | null = pick.item
  void item
}

function onClusterClick(pick: ClusterPick<Station>): void {
  // `items` 是可空的业务项数组（原生引擎下为 null）——不是 `any`、也不是永远有值
  const items: Station[] | null = pick.items
  void items
  // @ts-expect-error `engine` 只是两个字面量
  const notAnEngine: "nope" = pick.engine
  void notAnEngine
}
</script>

<template>
  <!-- ② 逆变门：处理器参数类型写死为 Station；推断成 unknown / any 都会失败 -->
  <MarkerList
    :data="stations"
    item-key="id"
    :get-position="(item: Station) => ({ lng: item.lng, lat: item.lat })"
    @item-click="onItemClick"
  />
  <!-- 默认引擎已是原生聚合（#35）；显式 engine="markers" 时 items 才有业务项 -->
  <MarkerCluster
    :data="stations"
    :item-key="(item) => item.id"
    :get-position="(item: Station) => ({ lng: item.lng, lat: item.lat })"
    :cluster-radius="60"
    @item-click="onItemClick"
    @cluster-click="onClusterClick"
  />
  <MarkerCluster
    engine="markers"
    :data="stations"
    item-key="id"
    :get-position="(item: Station) => ({ lng: item.lng, lat: item.lat })"
    :grid-size="64"
    @cluster-click="(cluster) => void (cluster.items?.[0] as Station | undefined)"
  />
  <PointCollection
    :data="stations"
    item-key="id"
    :get-position="(item: Station) => ({ lng: item.lng, lat: item.lat })"
    :properties="(item: Station) => ({ name: item.name ?? '未命名' })"
    :shape="0"
    :size="18"
    color="#1677ff"
    @item-click="onItemClick"
    @click="onPick"
  />
  <PointIconLayer
    :data="stations"
    item-key="id"
    :get-position="(item: Station) => ({ lng: item.lng, lat: item.lat })"
    icon="https://example.com/pin.png"
    :width="32"
    :height="32"
    :is-flat="true"
    @item-click="onItemClick"
  />
  <PointLayer
    :data="stations"
    :item-key="(item) => item.id"
    :get-position="(item: Station) => ({ lng: item.lng, lat: item.lat })"
    shape="circle"
    :size="18"
    fill-color="#1677ff"
    @item-click="onItemClick"
    @click="onPick"
  />
</template>
