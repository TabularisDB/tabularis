import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "it", "es", "zh", "fr", "de", "ja", "ru"],
  catalogs: [
    {
      path: "src/locales/{locale}/messages",
      include: ["src"],
    },
  ],
  format: formatter({ lineNumbers: false }),
});
