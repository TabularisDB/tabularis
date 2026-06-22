import type { Plugin } from "vite";

/** Dev-only Vite plugin that regenerates the Lingui catalogs on source change. */
export function linguiWatch(): Plugin;
