#!/usr/bin/env node
/**
 * Renders index.html into the files shipped next to it:
 *
 *   tabularis-oracle-plugin.mp4         1920x1080, H.264, for X / LinkedIn / YouTube
 *   tabularis-oracle-plugin.gif         960x540, for GitHub, Discord and Markdown
 *   tabularis-oracle-plugin-poster.png  1920x1080 still of the end card
 *
 * Usage: node render.mjs [--fps 60] [--gif-fps 15] [--gif-width 960] [--poster 18.2]
 *                        [--workers 3] [--out <dir>]
 *
 * Requirements: Playwright with Chromium (from this repo, NODE_PATH or the global
 * pnpm/npm root) and an ffmpeg build with libx264 on PATH, or set FFMPEG=/path/to/ffmpeg.
 * gifsicle (optional, GIFSICLE=...) halves the GIF with lossy LZW compression.
 * Every frame is produced by window.__seek(t), so the output is deterministic. Workers
 * render contiguous chunks into near-lossless intermediates that are then joined.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = "tabularis-oracle-plugin";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const GIFSICLE = process.env.GIFSICLE || "gifsicle";
const VIEWPORT = { width: 1920, height: 1080 };

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const FPS = Number(opt("fps", 60));
const GIF_FPS = Number(opt("gif-fps", 15));
const GIF_WIDTH = Number(opt("gif-width", 960));
const POSTER_T = Number(opt("poster", 18.2));
const WORKERS = Math.max(1, Number(opt("workers", Math.min(4, availableParallelism() - 1))));
const OUT = resolve(opt("out", HERE));

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ["playwright", "playwright-core"]) {
    try {
      return require(id);
    } catch {
      // try the next candidate
    }
  }
  for (const pm of ["pnpm", "npm"]) {
    try {
      const root = execFileSync(pm, ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return require(join(root, "playwright"));
    } catch {
      // not installed globally with this package manager
    }
  }
  console.error("Playwright not found. Install it (for example `pnpm add -g playwright`) or set NODE_PATH.");
  process.exit(1);
}

function ffmpeg(args, feed) {
  return new Promise((ok, fail) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: [feed ? "pipe" : "ignore", "inherit", "inherit"],
    });
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`))));
    if (feed) feed(p.stdin).catch(fail);
  });
}

const size = (f) => `${(statSync(f).size / 1024 / 1024).toFixed(2)} MB`;

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const url = `${pathToFileURL(join(HERE, "index.html")).href}?capture`;

async function openPage() {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const cdp = await page.context().newCDPSession(page);
  // Page.captureScreenshot with optimizeForSpeed is about twice as fast as page.screenshot().
  const shot = async (t) => {
    await page.evaluate((x) => window.__seek(x), t);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
    return Buffer.from(data, "base64");
  };
  return { page, shot };
}

const tmp = mkdtempSync(join(tmpdir(), `${NAME}-`));
try {
  const probe = await openPage();
  const duration = await probe.page.evaluate(() => window.__duration);
  const poster = join(OUT, `${NAME}-poster.png`);
  await probe.shot(POSTER_T);
  await probe.page.screenshot({ path: poster, type: "png" }); // better compressed than the fast path
  await probe.page.close();
  console.log(`${poster} ${size(poster)}`);

  // The last frame equals the first one (plain background): leave it out so the loop is seamless.
  const frames = Math.round(duration * FPS);
  const per = Math.ceil(frames / WORKERS);
  const chunks = [];
  let done = 0;
  const started = Date.now();
  const tick = setInterval(() => process.stdout.write(`\rframes ${done}/${frames}`), 1000);
  await Promise.all(
    Array.from({ length: WORKERS }, async (_, w) => {
      const from = w * per, to = Math.min(frames, from + per);
      if (from >= to) return;
      const file = join(tmp, `chunk-${w}.mkv`);
      chunks[w] = file;
      const { page, shot } = await openPage();
      await ffmpeg(
        ["-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
          "-c:v", "libx264rgb", "-crf", "4", "-preset", "veryfast", file],
        async (stdin) => {
          for (let f = from; f < to; f++) {
            if (!stdin.write(await shot(f / FPS))) await once(stdin, "drain");
            done++;
          }
          stdin.end();
        },
      );
      await page.close();
    }),
  );
  clearInterval(tick);
  console.log(`\rframes ${frames}/${frames} in ${((Date.now() - started) / 1000).toFixed(0)}s (${WORKERS} workers)`);
  await browser.close();

  const list = join(tmp, "chunks.txt");
  writeFileSync(list, chunks.filter(Boolean).map((c) => `file '${c}'`).join("\n"));
  const master = join(tmp, "master.mkv");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", master]);

  const mp4 = join(OUT, `${NAME}.mp4`);
  await ffmpeg(["-i", master, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", "-an", mp4]);
  console.log(`${mp4} ${size(mp4)}`);

  const palette = join(tmp, "palette.png");
  const scale = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos`;
  await ffmpeg(["-i", master, "-vf", `${scale},palettegen=max_colors=256:stats_mode=full`, palette]);
  const gif = join(OUT, `${NAME}.gif`);
  await ffmpeg(["-i", master, "-i", palette, "-lavfi",
    `${scale}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", gif]);
  try {
    execFileSync(GIFSICLE, ["-O3", "--lossy=30", "--batch", gif], { stdio: "ignore" });
  } catch {
    console.warn("gifsicle not found: the GIF stays unoptimized, about twice as large.");
  }
  console.log(`${gif} ${size(gif)}`);
} finally {
  await browser.close().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}
