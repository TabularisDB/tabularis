import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const runnerSource = join(process.cwd(), "web-ui-project/scripts/run-web-ui-tasks.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

describe("run-web-ui-tasks", () => {
  let root;
  let binDir;
  let piArgsFile;
  let curlArgsFile;
  let ghArgsFile;
  let ghWatchCountFile;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tabularis-web-ui-runner-"));
    binDir = join(root, "bin");
    piArgsFile = join(root, "pi-args.txt");
    curlArgsFile = join(root, "curl-args.txt");
    ghArgsFile = join(root, "gh-args.txt");
    ghWatchCountFile = join(root, "gh-watch-count.txt");

    mkdirSync(join(root, "web-ui-project/scripts"), { recursive: true });
    mkdirSync(join(root, "web-ui-project/tasks"), { recursive: true });
    mkdirSync(join(root, "web-ui-project/docs"), { recursive: true });
    mkdirSync(binDir);
    cpSync(runnerSource, join(root, "web-ui-project/scripts/run-web-ui-tasks.sh"));
    chmodSync(join(root, "web-ui-project/scripts/run-web-ui-tasks.sh"), 0o755);

    writeFileSync(join(root, "web-ui-project/docs/WEB_UI_PLAN.md"), "# Test plan\n");
    writeFileSync(join(root, "web-ui-project/tasks/WEB-999.md"), "# Test task\n");
    writeFileSync(
      join(root, "web-ui-project/tasks/PROGRESS.md"),
      "| Task | Status | Summary | Verification | Updated |\n" +
        "| --- | --- | --- | --- | --- |\n" +
        "| WEB-998 | PENDING | — | — | — |\n" +
        "| WEB-999 | PENDING | — | — | — |\n",
    );

    git(root, "init", "--quiet");
    git(root, "config", "user.name", "Runner Test");
    git(root, "config", "user.email", "runner@example.test");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "test fixture");

    writeExecutable(
      join(binDir, "pi"),
      `#!/usr/bin/env bash
printf '%s\\n' '--- invocation ---' "$@" >> "$MOCK_PI_ARGS_FILE"
if [[ " $* " != *" --print "* ]]; then
  sleep 30
  exit 99
fi
if [[ "\${PI_MOCK_RESULT:-success}" == "failure" ]]; then
  echo "mock Pi failure"
  exit 7
fi
cat > web-ui-project/tasks/PROGRESS.md <<'EOF'
| Task | Status | Summary | Verification | Updated |
| --- | --- | --- | --- | --- |
| WEB-998 | PENDING | — | — | — |
| WEB-999 | COMPLETED | Mock implementation | Mock verification | 2026-08-21 |
EOF
git add web-ui-project/tasks/PROGRESS.md
if [[ " $* " == *"ci-repair"* ]]; then
  echo "repaired" > ci-repair.txt
  git add ci-repair.txt
  git commit --quiet --amend --no-edit
  echo "mock Pi repaired CI"
else
  git commit --quiet -m "test: complete task"
  echo "mock Pi completed"
fi
`,
    );

    writeExecutable(
      join(binDir, "gh"),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$MOCK_GH_ARGS_FILE"
if [[ "$1 $2" == "run list" ]]; then
  echo "4242"
  exit 0
fi
if [[ "$1 $2" == "run watch" ]]; then
  count=0
  [[ ! -f "$MOCK_GH_WATCH_COUNT_FILE" ]] || count="$(cat "$MOCK_GH_WATCH_COUNT_FILE")"
  count=$((count + 1))
  printf '%s\\n' "$count" > "$MOCK_GH_WATCH_COUNT_FILE"
  if [[ "\${GH_MOCK_FAIL_ONCE:-}" == "1" && "$count" == "1" ]]; then
    echo "mock CI failure"
    exit 1
  fi
  echo "mock CI success"
  exit 0
fi
if [[ "$1 $2" == "run view" ]]; then
  echo "mock failed logs"
  exit 0
fi
exit 2
`,
    );

    writeExecutable(
      join(binDir, "curl"),
      `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$MOCK_CURL_ARGS_FILE"
printf '{"ok":true}\\n'
`,
    );
    writeExecutable(join(binDir, "notify-send"), "#!/usr/bin/env bash\nexit 0\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(extraEnv = {}) {
    return spawnSync("bash", ["web-ui-project/scripts/run-web-ui-tasks.sh", "WEB-999"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${binDir}:/usr/bin:/bin`,
        MOCK_PI_ARGS_FILE: piArgsFile,
        MOCK_CURL_ARGS_FILE: curlArgsFile,
        MOCK_GH_ARGS_FILE: ghArgsFile,
        MOCK_GH_WATCH_COUNT_FILE: ghWatchCountFile,
        TELEGRAM_BOT_TOKEN: "test-token",
        TELEGRAM_CHAT_ID: "-100123456",
        ...extraEnv,
      },
    });
  }

  it("creates runtime folders and resumes from the first pending task", () => {
    writeFileSync(join(root, "web-ui-project/tasks/WEB-997.md"), "# Completed task\n");
    writeFileSync(join(root, "web-ui-project/tasks/WEB-998.md"), "# First pending task\n");
    writeFileSync(
      join(root, "web-ui-project/tasks/PROGRESS.md"),
      "| Task | Status | Summary | Verification | Updated |\n" +
        "| --- | --- | --- | --- | --- |\n" +
        "| WEB-997 | COMPLETED | Existing | Verified | 2026-08-21 |\n" +
        "| WEB-998 | PENDING | — | — | — |\n" +
        "| WEB-999 | PENDING | — | — | — |\n",
    );

    const result = spawnSync(
      "bash",
      ["web-ui-project/scripts/run-web-ui-tasks.sh", "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${binDir}:/usr/bin:/bin`,
          MOCK_PI_ARGS_FILE: piArgsFile,
          MOCK_CURL_ARGS_FILE: curlArgsFile,
          MOCK_GH_ARGS_FILE: ghArgsFile,
          MOCK_GH_WATCH_COUNT_FILE: ghWatchCountFile,
          TELEGRAM_BOT_TOKEN: "test-token",
          TELEGRAM_CHAT_ID: "-100123456",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("web-ui-WEB-997");
    expect(result.stdout.indexOf("web-ui-WEB-998")).toBeLessThan(
      result.stdout.indexOf("web-ui-WEB-999"),
    );
    expect(existsSync(join(root, "web-ui-project/.runtime/logs"))).toBe(true);
  });

  it("notifies Telegram when a task starts and when it finishes", () => {
    const result = run();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(readFileSync(piArgsFile, "utf8").split("\n")).toContain("--print");
    expect(readFileSync(join(root, "web-ui-project/.runtime/state.tsv"), "utf8")).toContain(
      "\tWEB-999\tFINISHED\t",
    );

    const curlArgs = readFileSync(curlArgsFile, "utf8");
    expect(curlArgs.match(/sendMessage/g)).toHaveLength(2);
    expect(curlArgs).toContain("https://api.telegram.org/bottest-token/sendMessage");
    expect(curlArgs).toContain("chat_id=-100123456");
    expect(curlArgs).toContain("text=Web UI task started: WEB-999 (progress: 0.0% (0/2); log:");
    expect(curlArgs).toContain(
      "text=Web UI task finished: WEB-999 completed, validated, and CI is green (progress: 50.0% (1/2))",
    );
  });

  it("starts a Pi repair session after failed CI and watches the amended result", () => {
    const result = run({ GH_MOCK_FAIL_ONCE: "1" });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const piArgs = readFileSync(piArgsFile, "utf8");
    expect(piArgs.match(/--- invocation ---/g)).toHaveLength(2);
    expect(piArgs).toContain("web-ui-WEB-999-ci-repair-1");
    expect(piArgs).toContain("Repair the failed CI for exactly task WEB-999");

    const state = readFileSync(join(root, "web-ui-project/.runtime/state.tsv"), "utf8");
    expect(state).toContain("\tWEB-999\tCI_REPAIR(1)\t");
    expect(state).toContain("\tWEB-999\tFINISHED\t");

    const ghArgs = readFileSync(ghArgsFile, "utf8");
    expect(ghArgs.match(/run watch 4242 --exit-status/g)).toHaveLength(2);
    expect(ghArgs).toContain("run view 4242 --log-failed");
    expect(readFileSync(ghWatchCountFile, "utf8").trim()).toBe("2");

    const curlArgs = readFileSync(curlArgsFile, "utf8");
    expect(curlArgs.match(/sendMessage/g)).toHaveLength(3);
    expect(curlArgs).toContain("text=Web UI task CI repair: WEB-999 repair 1/3");
    expect(curlArgs).toContain("progress: 50.0% (1/2)");
  });

  it("returns Pi's failure status and sends a terminal failure notification", () => {
    const result = run({ PI_MOCK_RESULT: "failure" });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(7);
    expect(readFileSync(join(root, "web-ui-project/.runtime/state.tsv"), "utf8")).toContain(
      "\tWEB-999\tFAILED(7)\t",
    );
    const curlArgs = readFileSync(curlArgsFile, "utf8");
    expect(curlArgs.match(/sendMessage/g)).toHaveLength(2);
    expect(curlArgs).toContain("text=Web UI task started: WEB-999 (progress: 0.0% (0/2); log:");
    expect(curlArgs).toContain(
      "text=Web UI task failed: WEB-999 exited with status 7 (progress: 0.0% (0/2))",
    );
  });

  it("notifies Telegram when a completed task is skipped", () => {
    writeFileSync(
      join(root, "web-ui-project/tasks/PROGRESS.md"),
      "| Task | Status | Summary | Verification | Updated |\n" +
        "| --- | --- | --- | --- | --- |\n" +
        "| WEB-999 | COMPLETED | Existing implementation | Existing verification | 2026-08-21 |\n",
    );
    git(root, "add", "web-ui-project/tasks/PROGRESS.md");
    git(root, "commit", "--quiet", "-m", "test: mark task completed");

    const result = run();

    expect(result.status).toBe(0);
    expect(readFileSync(join(root, "web-ui-project/.runtime/state.tsv"), "utf8")).toContain(
      "\tWEB-999\tSKIPPED(COMPLETED)\t",
    );
    expect(readFileSync(curlArgsFile, "utf8")).toContain(
      "text=Web UI task skipped: WEB-999 is already completed",
    );
    expect(() => readFileSync(piArgsFile, "utf8")).toThrow();
  });

  it("rejects incomplete Telegram configuration before starting Pi", () => {
    const result = run({ TELEGRAM_CHAT_ID: "" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together.",
    );
    expect(() => readFileSync(piArgsFile, "utf8")).toThrow();
  });
});
