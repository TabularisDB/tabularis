#!/usr/bin/env node
// Isolated manual-test data only. No upstream requests, database or disk writes.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const family = process.argv[2] ?? "original";
const port = Number(process.argv[3] ?? "49179");
if (!["original", "imported"].includes(family) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Usage: node manual-registry.mjs [original|imported] [loopback-port]");
const artifacts = new Map(["1.0.0", "2.0.0"].map((version, index) => {
  const bytes = readFileSync(new URL(`./author/${family}-v${index + 1}.zip`, import.meta.url));
  return [version, { bytes, sha256: createHash("sha256").update(bytes).digest("hex") }];
}));
let latest = "1.0.0";
let tamper = false;
let slow = false;
const counts = { "1.0.0": 0, "2.0.0": 0 };
let base;
const total = () => counts["1.0.0"] + counts["2.0.0"];
const detail = () => ({
  id: "fixture-theme", ownerId: "fixture-owner", name: `${family} fixture theme`, description: "Local-only author fixture; not a release or safe published minimum.", author: "Fixture author", repoUrl: "https://example.invalid/theme", homepage: base,
  latestVersion: latest, status: "approved", tags: ["blue", "theme"], screenshots: [], featured: false, verified: false, downloads: total(), readmeAvailableLocales: ["en"], readmeLocale: "en", readmeHtml: "<h1>Offline theme fixture</h1><p>This README request does not increment downloads.</p>", documentationUrl: null, createdAt: 0, updatedAt: 0,
  releases: [...artifacts].map(([version, artifact]) => ({ id: `fixture-${version}`, pluginId: "fixture-theme", version, minRuntimeVersion: "0.24.0", assets: { universal: { url: `${base}/assets/${version}.zip`, sha256: tamper ? "0".repeat(64) : artifact.sha256, size: artifact.bytes.length } }, createdAt: 0, integrity: null })),
});
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", base);
  const path = url.pathname.replace(/\/+$/, "");
  response.setHeader("X-Tabularis-Theme-Fixture", "791");
  const json = (value, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  if (request.method !== "GET") return json({ error: "Read-only fixture API; use terminal commands" }, 405);
  if (path === "/__fixture/status") return json({ family, latest, counts, total: total(), tamper, slow, pid: process.pid });
  if (path === "/api/kinds") return json({ kinds: [{ key: "driver", label: "Driver", description: null }, { key: "theme", label: "Theme", description: null }] });
  if (path === "/api/plugins") {
    const plugins = !url.searchParams.has("kind") || url.searchParams.get("kind") === "theme" ? [detail()] : [];
    return json({ total: plugins.length, page: 1, limit: 100, plugins, facets: { categories: [], kinds: [] } });
  }
  if (path === "/api/plugins/fixture-theme") return json(detail());
  const integrity = path.match(/^\/api\/plugins\/fixture-theme\/releases\/([^/]+)\/integrity$/);
  if (integrity && artifacts.has(integrity[1])) return json({ slug: "fixture-theme", version: integrity[1], assets: {} });
  const pinned = path.match(/^\/api\/plugins\/fixture-theme\/releases\/([^/]+)$/);
  if (path === "/api/plugins/fixture-theme/latest" || pinned) {
    const version = pinned?.[1] ?? latest;
    if (!artifacts.has(version)) return json({ error: "Unknown fixture release" }, 404);
    counts[version]++; // Same request-count rule, with or without redirect=1.
    console.log(JSON.stringify({ tracked: request.url, counts, total: total() }));
    if (url.searchParams.get("redirect") === "1") { response.writeHead(302, { Location: `${base}/assets/${version}.zip` }); return response.end(); }
    return json({ version, url: `${base}/assets/${version}.zip` });
  }
  const asset = path.match(/^\/assets\/([^/]+)\.zip$/);
  if (asset && artifacts.has(asset[1])) {
    const { bytes } = artifacts.get(asset[1]); response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": bytes.length });
    if (!slow) return response.end(bytes);
    let offset = 0;
    const timer = setInterval(() => { const end = Math.min(offset + 64, bytes.length); response.write(bytes.subarray(offset, end)); offset = end; if (offset === bytes.length) { clearInterval(timer); response.end(); } }, 100);
    response.on("close", () => clearInterval(timer)); return;
  }
  return json({ error: "Unknown local fixture route" }, 404);
});
server.listen(port, "127.0.0.1", () => {
  base = `http://127.0.0.1:${server.address().port}`;
  console.log(JSON.stringify({ fixture: 791, base, family, pid: process.pid, commands: "next | first | tamper | slow | counts | quit" }));
});
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  switch (line.trim()) {
    case "next": latest = "2.0.0"; break;
    case "first": latest = "1.0.0"; break;
    case "tamper": tamper = !tamper; break;
    case "slow": slow = !slow; break;
    case "counts": break;
    case "quit": server.close(); input.close(); return;
    default: console.log("Commands: next | first | tamper | slow | counts | quit"); return;
  }
  console.log(JSON.stringify({ family, latest, counts, tamper, slow }));
});
process.on("SIGTERM", () => { server.close(); input.close(); });
