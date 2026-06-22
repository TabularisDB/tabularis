import { spawn } from "node:child_process";

// Dev-only Vite plugin: regenerate the Lingui catalogs whenever a source file
// changes, so new `t`/`<Trans>` strings show up in the running app.
//
// This runs inside Vite's own dev server (which is already watching files and
// owns HMR), so `tauri dev` needs nothing more than its usual `npm run dev` —
// no extra process, no `concurrently`. Extract and compile run SEQUENTIALLY in
// one debounced job (two parallel `lingui --watch` processes race and crash on
// Linux). Changes under src/locales — the catalogs we write — are ignored so we
// don't loop. When `messages.ts` is recompiled, Vite reloads it automatically.
export function linguiWatch() {
  let running = false;
  let queued = false;
  let timer = null;

  const run = (command) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, { stdio: "inherit", shell: true });
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`\`${command}\` exited with ${code}`)),
      );
      child.on("error", reject);
    });

  async function regenerate() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await run("lingui extract");
      await run("lingui compile --typescript --namespace es");
    } catch (err) {
      console.error("[i18n] regenerate failed:", err.message);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(regenerate, 400);
  }

  return {
    name: "lingui-watch",
    apply: "serve", // dev server only — never runs during `vite build`
    configureServer(server) {
      void regenerate(); // initial catalog refresh on dev start
      const onChange = (file) => {
        if (!/\.(ts|tsx)$/.test(file)) return;
        if (/[\\/]locales[\\/]/.test(file)) return; // our own output
        schedule();
      };
      server.watcher.on("change", onChange);
      server.watcher.on("add", onChange);
    },
  };
}
