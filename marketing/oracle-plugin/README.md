# Oracle plugin launch animation

A 20-second looping animation announcing the [Oracle plugin](https://github.com/TabularisDB/tabularis-oracle-plugin) (v0.1.0).

| File | Use |
| --- | --- |
| `tabularis-oracle-plugin.mp4` | 1920×1080, 60 fps, H.264: X, LinkedIn, YouTube, Mastodon, Bluesky |
| `tabularis-oracle-plugin.gif` | 960×540, 15 fps: GitHub (README, releases, discussions), Discord, Reddit |
| `tabularis-oracle-plugin-poster.png` | 1920×1080 still of the end card: link previews, video thumbnail |
| `index.html` | Source of the animation |
| `render.mjs` | Renders `index.html` into the three files above |

## Storyboard

1. The Tabularis cube builds itself, with the wordmark and tagline.
2. The Oracle plugin tile plugs into the logo: "Tabularis now speaks Oracle."
3. A recreation of the app (Tabularis Dark theme):
   1. the plugin is installed from the database catalogue,
   2. a connection to `FREEPDB1` is configured and tested,
   3. the `SHOP` schema appears in the explorer (Oracle types such as `VARCHAR2`, `NUMBER`, `TIMESTAMP(6)`) and a query runs,
   4. Visual EXPLAIN shows the plan with runtime statistics.
4. End card with the feature list, where to install it and the requirements.

The schema, query, results and plan are the ones in the plugin's own screenshots, and every
feature named on screen comes from the plugin README, so the animation claims nothing the
plugin does not do.

## Preview

Open `index.html` in a browser. Space pauses, the arrow keys scrub (Shift for a single frame)
and `index.html?t=12` starts at a given second. With reduced motion enabled the page shows
the end card without animating.

## Render

```sh
node render.mjs
```

It needs Playwright with Chromium (from the repo, `NODE_PATH` or the global pnpm/npm root) and an
ffmpeg build with libx264 on `PATH` (or `FFMPEG=/path/to/ffmpeg`). Options: `--fps 60`,
`--gif-fps 15`, `--gif-width 960`, `--poster 18.2` (time of the poster frame in seconds),
`--workers 3` (parallel browser pages) and `--out <dir>`. Rendering takes a few minutes and is
deterministic: every frame comes from `window.__seek(t)`, nothing depends on the wall clock.

## Editing

All copy lives in the markup of `index.html` (headline `#s2title`, captions `.cap`, end card
`#end`) and the app data in the `TREE`, `SQL`, `RESULTS`, `CARDS` and `PLAN` constants. Timing
is in the `K` constants and the keyframe tracks (`heroes`, `CAM`, `CUR`); keep `DURATION` and
the fades in `renderBackground` in sync so the loop stays seamless.

Fonts: Inter and JetBrains Mono (SIL Open Font License 1.1, see `fonts/`). The Oracle tile is
the plugin's own icon (`oracle-icon.svg`), not Oracle's logo.
