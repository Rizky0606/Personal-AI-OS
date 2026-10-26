export * from './api-schemas.js';
export * from './endpoint.js';
import { authDevicesEndpoints } from './endpoints/auth-devices.js';
import { catalogEndpoints } from './endpoints/catalog.js';
import { chatEndpoints } from './endpoints/chat.js';
import { workEndpoints } from './endpoints/work.js';
import { memoryEndpoints } from './endpoints/memory.js';
import { templateEndpoints } from './endpoints/templates.js';
import { spaceEndpoints } from './endpoints/spaces.js';
import { miscEndpoints } from './endpoints/misc.js';
import type { Endpoint } from './endpoint.js';

/** Semua endpoint REST, urut per area seperti tabel di API_CONTRACT.md. */
export const endpoints: readonly Endpoint[] = [
  ...authDevicesEndpoints,
  ...catalogEndpoints,
  ...chatEndpoints,
  ...workEndpoints,
  ...miscEndpoints,
  ...memoryEndpoints,
  ...templateEndpoints,
  ...spaceEndpoints,
];
