<template>
  <!-- ak 由文档站的应用级装配提供（createBMapPlugin({ ak })），示例不携带密钥 -->
  <Map v-bind="$attrs" enableScrollWheelZoom>
    <PanoramaControl />
    <PanoramaCoverageLayer />
  </Map>
</template>
