// Tests that need recipe code, notes or lowered text read the FULL catalog through this loader (#131): site/data/catalog.json is only the eager index,
// the bodies live in site/data/recipes/<family>.json. Index-only checks (ids, folders, tags, counts) may read data/catalog.json directly.
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { readCatalog } from '../../tools/catalog/lib.mjs';
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fullCatalog = (root = REPO) => readCatalog(root);
