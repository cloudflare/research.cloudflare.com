/**
 * Single source of truth for the package version. Read at module-
 * load time from `package.json`; baked into R2 metadata, build
 * reports, and the runtime bridge.
 */

import pkg from "../package.json" with { type: "json" };

export const POLYSTELLA_VERSION: string = pkg.version;
