import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    realtime: { allowedOrigins: ["http://localhost:3008", "http://127.0.0.1:3008", "http://localhost:5173"] },
  },
  auth: true,
  aiGateway: true,
  functions: {
    hello: { name: "Hello World", source: "./hello.ts" },
    demosummary: { name: "Tabularis Demo Analysis", source: "../../examples/neon-demo/functions/summary.ts" },
  },
  buckets: {
    // "private" is the default; use "public_read" for anonymous reads
    assets: { access: "private" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
