import { createDataTools, type DataToolsDeps } from './data-tools.js';
import { createProposeTools, type ProposeToolsDeps } from './propose-tools.js';
import { combineTools, type ToolSet } from './tools.js';
import { createWebTools, type WebToolsDeps } from './web-tools.js';

/**
 * Semua tool server `aios_tools` berurutan (web, data, usulan). Tool usulan diberi tahu pemakaian tool web per kunci
 * anggaran supaya usulan Hermes (tanpa `run_events`) tetap bertanda `afterWeb`.
 */
export function createAiosTools(deps: {
  web: WebToolsDeps;
  data: DataToolsDeps;
  propose: Omit<ProposeToolsDeps, 'webUsed'>;
}): ToolSet {
  const web = createWebTools(deps.web);
  return combineTools(
    web,
    createDataTools(deps.data),
    createProposeTools({ ...deps.propose, webUsed: (key) => web.usedWeb(key) }),
  );
}
