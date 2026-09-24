<template>
  <Map v-bind="$attrs">
    <OverviewMapControl :is-open="true" :size="{ x: 180, y: 180 }" />
  </Map>
</template>
