<template>
  <Map v-bind="$attrs" enableWheelZoom>
    <PanoramaControl />
    <PanoramaCoverageLayer />
  </Map>
</template>
