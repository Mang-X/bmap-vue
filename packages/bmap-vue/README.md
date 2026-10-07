# @mangax/bmap-vue

Vue 3 components and hooks for Baidu Maps JavaScript API 4.0.

## Install

```bash
pnpm add @mangax/bmap-vue
```

The map SDK is loaded by default through the official
[`@baidumap/jsapi-loader`](https://www.npmjs.com/package/@baidumap/jsapi-loader) —
you do not need to add a `<script>` tag yourself.

## Styles

The `<Autocomplete>` input styles ship as a separate subpath. Import it once where you use
the component (no other component needs it):

```ts
import '@mangax/bmap-vue/styles.css'
```

## Usage

```vue
<template>
  <Map :ak="ak" v-model:center="center" :zoom="12">
    <Marker :position="center" />
    <NavigationControl anchor="BMAP_ANCHOR_TOP_RIGHT" />
  </Map>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Map, Marker, NavigationControl } from '@mangax/bmap-vue'
import type { Point } from '@mangax/bmap-vue'

const ak = 'your Baidu Maps ak'
const center = ref<Point>({ lng: 116.404, lat: 39.915 })
</script>
```

`ak` is passed once — on `<Map>` (above), or globally via
`app.use(createBMapPlugin({ ak }))`. `<BMapProvider>` does **not** take an `ak` of its own;
to give a subtree the app-wide default, pass nothing:

```vue
<template>
  <BMapProvider>
    <Map :zoom="12">
      <ZoomControl />
    </Map>
  </BMapProvider>
</template>

<script setup lang="ts">
import { BMapProvider, Map, ZoomControl } from '@mangax/bmap-vue'
</script>
```

`<BMapProvider>` provides the Client context to its subtree, so service composables work
inside it without a `<Map>`. It does **not** take an `ak` of its own: to give a subtree an
explicit definition, pass `provider` (with `loadOptions`) or a whole `definition`.

```vue
<template>
  <BMapProvider :provider="provider" :load-options="loadOptions">
    <Map :zoom="12">
      <ZoomControl />
    </Map>
  </BMapProvider>
</template>

<script setup lang="ts">
import { BMapProvider, Map, ZoomControl } from '@mangax/bmap-vue'
import { baiduJsapiV4Provider } from '@mangax/bmap-vue/advanced'

const ak = 'your Baidu Maps ak'
const provider = baiduJsapiV4Provider()
// `loadOptions` 只在**同时**传了 `provider` 时被读取
const loadOptions = { ak }
</script>
```

To share one `ak` across a whole app, register the plugin once (this snippet continues
from the `<Map>` example above — `App` is your root component):

```ts
import { createApp } from 'vue'
import { createBMapPlugin } from '@mangax/bmap-vue'
import App from './App.vue'

const app = createApp(App)
app.use(createBMapPlugin({ ak: 'your Baidu Maps ak' }))
app.mount('#app')
```

Standard UI (place search, result lists, pagination, route panels) is provided by
the official [`@baidumap/jsapi-ui-kit`](https://www.npmjs.com/package/@baidumap/jsapi-ui-kit),
an optional peer — see the [UI Kit guide](https://github.com/Mang-X/bmap-vue/blob/main/docs/zh-CN/guide/ui-kit.md).

This package is published as `@mangax/bmap-vue` and follows the 1.0 release line. It began
as [yue1123/vue3-baidu-map-gl](https://github.com/yue1123/vue3-baidu-map-gl); see
the repository [README](https://github.com/Mang-X/bmap-vue#readme),
[ACKNOWLEDGEMENTS](https://github.com/Mang-X/bmap-vue/blob/main/ACKNOWLEDGEMENTS.md),
[NOTICE](https://github.com/Mang-X/bmap-vue/blob/main/NOTICE.md), and
[LICENSE](https://github.com/Mang-X/bmap-vue/blob/main/LICENSE) for the project
history and attribution.
