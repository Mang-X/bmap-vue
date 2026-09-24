export type {
  Capability,
  CapabilityDescriptor,
  CapabilityFamily,
  CapabilityStatus,
} from "./catalog";
export {
  CAPABILITY_CATALOG,
  CAPABILITY_FAMILIES,
  CAPABILITY_IDS,
  CAPABILITY_STATUSES,
} from "./catalog";
export type {
  CapabilityExplanation,
  CapabilityReason,
  CapabilityRegistry,
  CreateCapabilityRegistryOptions,
} from "./registry";
export { createCapabilityRegistry } from "./registry";
export { UnsupportedCapabilityError } from "./unsupported";
export type { UnsupportedBehavior } from "./unsupported";
