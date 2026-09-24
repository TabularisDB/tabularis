#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
PROJECT_DIR="${ROOT_DIR}/web-ui-project"
PLAN_FILE="${PROJECT_DIR}/docs/WEB_UI_PLAN.md"
TASK_DIR="${PROJECT_DIR}/tasks"
PROGRESS_FILE="${TASK_DIR}/PROGRESS.md"
RUN_DIR="${PROJECT_DIR}/.runtime"
LOG_DIR="${RUN_DIR}/logs"
STATE_FILE="${RUN_DIR}/state.tsv"
LOCK_DIR="${RUN_DIR}/lock"
THINKING="${PI_WEB_UI_THINKING:-high}"
MODEL="${PI_WEB_UI_MODEL:-}"
CI_REPAIR_ATTEMPTS="${PI_WEB_UI_CI_REPAIR_ATTEMPTS:-3}"
CI_DISCOVERY_ATTEMPTS="${PI_WEB_UI_CI_DISCOVERY_ATTEMPTS:-30}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
NOTIFY=1
DRY_RUN=0
FORCE=0
TASKS=()

usage() {
  cat <<'EOF'
Usage: web-ui-project/scripts/run-web-ui-tasks.sh [options] [WEB-NNN ...]

Runs one non-interactive Pi CLI session per task file, sequentially. With no
task IDs, processing resumes at the first PENDING task in
web-ui-project/tasks/PROGRESS.md. The runner stops at the first failed or
unvalidated task. Runtime logs and state are written under
web-ui-project/.runtime/ (ignored by Git).

Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to receive a Telegram message for
each task state change (started, skipped, finished, or failed). Both variables
must be set together. Dry runs do not send external notifications.

Options:
  --model MODEL       Pi model pattern (default: Pi configuration)
  --thinking LEVEL    Thinking level (default: high)
  --no-notify         Disable desktop notifications
  --dry-run           Print the sessions that would run
  --force             Run tasks even when PROGRESS.md says COMPLETED
  -h, --help          Show this help

Environment:
  PI_WEB_UI_CI_REPAIR_ATTEMPTS     Maximum CI repair sessions (default: 3)
  PI_WEB_UI_CI_DISCOVERY_ATTEMPTS  CI run lookup retries, two seconds each (default: 30)

Examples:
  pnpm web:tasks
  pnpm web:tasks WEB-000
  pnpm web:tasks WEB-001 WEB-002
  PI_WEB_UI_MODEL=openai/gpt-5.6-sol pnpm web:tasks WEB-010
EOF
}

notify() {
  local title="$1"
  local message="$2"
  printf '\a[%s] %s: %s\n' "$(date --iso-8601=seconds)" "$title" "$message"

  if (( NOTIFY )) && command -v notify-send >/dev/null 2>&1; then
    notify-send "$title" "$message" >/dev/null 2>&1 || true
  fi
}

notify_telegram() {
  local title="$1"
  local message="$2"

  [[ -n "$TELEGRAM_BOT_TOKEN" ]] || return 0

  if ! curl --silent --show-error --fail-with-body \
    --connect-timeout 5 --max-time 15 --retry 2 \
    --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${title}: ${message}" \
    >/dev/null; then
    echo "Warning: failed to send Telegram notification." >&2
  fi
}

record_task_state() {
  local task="$1"
  local state="$2"
  local reference="$3"
  local title="$4"
  local message="$5"

  printf '%s\t%s\t%s\t%s\n' \
    "$(date --iso-8601=seconds)" "$task" "$state" "$reference" >> "$STATE_FILE"
  notify "$title" "$message"
  notify_telegram "$title" "$message"
}

completion_progress() {
  awk -F '|' '
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    {
      task = trim($2)
      status = trim($3)
      if (task ~ /^WEB-[0-9][0-9][0-9]$/) {
        total++
        if (status == "COMPLETED") completed++
      }
    }
    END {
      percentage = total == 0 ? 0 : completed * 100 / total
      printf "%.1f%% (%d/%d)", percentage, completed, total
    }
  ' "$PROGRESS_FILE"
}

progress_field() {
  local task="$1"
  local column="$2"

  awk -F '|' -v task="$task" -v column="$column" '
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    trim($2) == task { print trim($column) }
  ' "$PROGRESS_FILE"
}

find_ci_run() {
  local head_sha="$1"
  local attempt run_id

  for ((attempt = 1; attempt <= CI_DISCOVERY_ATTEMPTS; attempt++)); do
    run_id="$(gh run list --workflow CI --commit "$head_sha" --limit 1 \
      --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)"
    if [[ -n "$run_id" ]]; then
      printf '%s\n' "$run_id"
      return 0
    fi
    sleep 2
  done
  return 1
}

watch_task_ci() {
  local task="$1"
  local log_file="$2"
  local head_sha run_id watch_status

  head_sha="$(git rev-parse HEAD)"
  if ! run_id="$(find_ci_run "$head_sha")"; then
    echo "No CI run found for $task at $head_sha." | tee -a "$log_file" >&2
    FAILED_CI_REFERENCE="commit $head_sha with no CI run"
    return 1
  fi

  FAILED_CI_REFERENCE="run $run_id for commit $head_sha"
  echo "Watching CI run $run_id for $task at $head_sha." | tee -a "$log_file"
  set +e
  gh run watch "$run_id" --exit-status 2>&1 | tee -a "$log_file"
  watch_status=${PIPESTATUS[0]}
  set -e
  if (( watch_status != 0 )); then
    echo "CI run $run_id failed; collecting failed logs for repair." | tee -a "$log_file" >&2
    gh run view "$run_id" --log-failed 2>&1 | tee -a "$log_file" || true
  fi
  return "$watch_status"
}

validate_progress_entry() {
  local task="$1"
  local row_count status summary verification updated

  row_count="$(awk -F '|' -v task="$task" '
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    trim($2) == task { count++ }
    END { print count + 0 }
  ' "$PROGRESS_FILE")"
  [[ "$row_count" == "1" ]] || {
    echo "PROGRESS.md must contain exactly one row for $task." >&2
    return 1
  }

  status="$(progress_field "$task" 3)"
  summary="$(progress_field "$task" 4)"
  verification="$(progress_field "$task" 5)"
  updated="$(progress_field "$task" 6)"

  [[ "$status" == "COMPLETED" ]] || {
    echo "$task is not COMPLETED in PROGRESS.md (status: $status)." >&2
    return 1
  }
  [[ -n "$summary" && "$summary" != "—" ]] || {
    echo "$task has no completion summary in PROGRESS.md." >&2
    return 1
  }
  [[ -n "$verification" && "$verification" != "—" ]] || {
    echo "$task has no verification evidence in PROGRESS.md." >&2
    return 1
  }
  [[ "$updated" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
    echo "$task has no valid ISO completion date in PROGRESS.md." >&2
    return 1
  }
  git ls-files --error-unmatch "$PROGRESS_FILE" >/dev/null 2>&1 || {
    echo "PROGRESS.md must be committed before $task can be validated." >&2
    return 1
  }
  if ! git diff --quiet -- "$PROGRESS_FILE" || \
    ! git diff --cached --quiet -- "$PROGRESS_FILE"; then
    echo "PROGRESS.md has uncommitted changes; commit the $task record first." >&2
    return 1
  fi
}

while (($#)); do
  case "$1" in
    --model)
      [[ $# -ge 2 ]] || { echo "Missing value for --model" >&2; exit 2; }
      MODEL="$2"
      shift 2
      ;;
    --thinking)
      [[ $# -ge 2 ]] || { echo "Missing value for --thinking" >&2; exit 2; }
      THINKING="$2"
      shift 2
      ;;
    --no-notify)
      NOTIFY=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    WEB-[0-9][0-9][0-9])
      TASKS+=("$1")
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -n "$ROOT_DIR" ]] || { echo "Run this script inside the Tabularis repository." >&2; exit 1; }
mkdir -p "$PROJECT_DIR/docs" "$TASK_DIR" "$PROJECT_DIR/scripts" \
  "$PROJECT_DIR/tests" "$LOG_DIR"
[[ -f "$PLAN_FILE" ]] || { echo "Missing tracked plan: $PLAN_FILE" >&2; exit 1; }
[[ -f "$PROGRESS_FILE" ]] || { echo "Missing tracked progress ledger: $PROGRESS_FILE" >&2; exit 1; }
command -v pi >/dev/null 2>&1 || { echo "pi is not available in PATH." >&2; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "gh is not available in PATH." >&2; exit 1; }
[[ "$CI_REPAIR_ATTEMPTS" =~ ^[0-9]+$ ]] || {
  echo "PI_WEB_UI_CI_REPAIR_ATTEMPTS must be a non-negative integer." >&2
  exit 1
}
[[ "$CI_DISCOVERY_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || {
  echo "PI_WEB_UI_CI_DISCOVERY_ATTEMPTS must be a positive integer." >&2
  exit 1
}
if [[ -n "$TELEGRAM_BOT_TOKEN" || -n "$TELEGRAM_CHAT_ID" ]]; then
  [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]] || {
    echo "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together." >&2
    exit 1
  }
  command -v curl >/dev/null 2>&1 || { echo "curl is required for Telegram notifications." >&2; exit 1; }
fi

if ((${#TASKS[@]} == 0)); then
  resume_from_pending=0
  while IFS= read -r task_file; do
    task="$(basename "$task_file" .md)"
    task_status="$(progress_field "$task" 3)"
    if (( ! resume_from_pending )) && [[ "$task_status" == "PENDING" ]]; then
      resume_from_pending=1
    fi
    if (( resume_from_pending )); then
      TASKS+=("$task")
    fi
  done < <(find "$TASK_DIR" -maxdepth 1 -type f -name 'WEB-[0-9][0-9][0-9].md' | sort)
fi
if ((${#TASKS[@]} == 0)); then
  echo "No PENDING Web UI tasks remain in $PROGRESS_FILE."
  exit 0
fi

cd "$ROOT_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another Web UI task runner appears to be active: $LOCK_DIR" >&2
  exit 1
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

for task in "${TASKS[@]}"; do
  task_file="${TASK_DIR}/${task}.md"
  [[ -f "$task_file" ]] || { echo "Task file not found: $task_file" >&2; exit 2; }

  row_count="$(progress_field "$task" 2 | wc -l)"
  [[ "$row_count" == "1" ]] || {
    echo "PROGRESS.md must contain exactly one row for $task." >&2
    exit 2
  }
done

for task in "${TASKS[@]}"; do
  task_file="${TASK_DIR}/${task}.md"
  progress_status="$(progress_field "$task" 3)"
  case "$progress_status" in
    PENDING|IN_PROGRESS|BLOCKED|COMPLETED) ;;
    *) echo "Invalid PROGRESS.md status for $task: $progress_status" >&2; exit 2 ;;
  esac

  if [[ "$progress_status" == "COMPLETED" ]] && (( ! FORCE )); then
    validate_progress_entry "$task" || exit 1
    record_task_state "$task" "SKIPPED(COMPLETED)" "$task_file" \
      "Web UI task skipped" "$task is already completed (progress: $(completion_progress))"
    continue
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  log_file="${LOG_DIR}/${timestamp}-${task}.log"
  prompt=$(cat <<EOF
Execute exactly task ${task} from ${task_file} in the current repository.

Mandatory workflow:
- Read ${task_file}, ${PLAN_FILE}, ${PROGRESS_FILE}, the Standard task loop, AGENTS instructions, and all relevant repository rules before editing.
- Work only on ${task}; do not start later tasks and do not invoke this runner or spawn another agent.
- Inspect git status first. Preserve unrelated changes and never discard user work.
- Follow the required GitNexus impact/change-detection workflow and report high or critical risk before editing.
- Establish focused baseline tests, implement the smallest complete change, and run all applicable verification from the plan.
- Keep desktop compatibility and use English for code, comments, documentation, and commit messages.
- Set ${task} to IN_PROGRESS in ${PROGRESS_FILE} before implementation.
- Review the full diff and git diff --check.
- When verified, set ${task} to COMPLETED in PROGRESS.md with a concise single-line summary, verification evidence, and an ISO date. Do not use the | character in progress fields.
- Create the task's single conventional commit, including its PROGRESS.md update, and push feat/web-ui only when tests are green.
- Watch the pushed commit with gh run watch --exit-status. If CI fails, inspect gh run view --log-failed, fix every task-related failure, rerun the affected checks, amend the same task commit, push with --force-with-lease, and watch the replacement run. Repeat until CI is green; never claim completion after a failed watch.
- If blocked, set ${task} to BLOCKED with the blocker and available verification evidence, then stop without claiming completion. Leave the repository in a safe, inspectable state.
- Finish with a concise summary containing status (COMPLETED or BLOCKED), commit hash if completed, tests run, and remaining concerns.
EOF
)

  cmd=(pi --print --approve --name "web-ui-${task}" --thinking "$THINKING")
  [[ -z "$MODEL" ]] || cmd+=(--model "$MODEL")
  cmd+=("@${PLAN_FILE}" "@${task_file}" "@${PROGRESS_FILE}" "$prompt")

  if (( DRY_RUN )); then
    printf 'DRY RUN:'
    printf ' %q' "${cmd[@]}"
    printf '\n'
    printf '%s\t%s\tDRY-RUN\t%s\n' \
      "$(date --iso-8601=seconds)" "$task" "$task_file" >> "$STATE_FILE"
    continue
  fi

  record_task_state "$task" "STARTED" "$log_file" \
    "Web UI task started" "$task (progress: $(completion_progress); log: $log_file)"

  set +e
  env -u PI_SESSION_ID -u PI_SESSION_FILE -u PI_PROVIDER -u PI_MODEL \
    -u PI_REASONING_LEVEL "${cmd[@]}" 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}
  set -e

  if validate_progress_entry "$task"; then
    if (( status != 0 )); then
      record_task_state "$task" "RECOVERING(PI-${status})" "$log_file" \
        "Web UI task CI recovery" \
        "$task returned status $status after committing completion; validating CI (progress: $(completion_progress))"
    fi

    repair_attempt=0
    while ! watch_task_ci "$task" "$log_file"; do
      if (( repair_attempt >= CI_REPAIR_ATTEMPTS )); then
        record_task_state "$task" "FAILED(CI)" "$log_file" \
          "Web UI task CI failed" \
          "$task exhausted $CI_REPAIR_ATTEMPTS repair attempts after $FAILED_CI_REFERENCE (progress: $(completion_progress))"
        exit 1
      fi

      repair_attempt=$((repair_attempt + 1))
      record_task_state "$task" "CI_REPAIR(${repair_attempt})" "$log_file" \
        "Web UI task CI repair" \
        "$task repair $repair_attempt/$CI_REPAIR_ATTEMPTS for $FAILED_CI_REFERENCE (progress: $(completion_progress))"

      repair_prompt=$(cat <<EOF
Repair the failed CI for exactly task ${task}. The failed reference is ${FAILED_CI_REFERENCE}.

Mandatory workflow:
- Inspect the failure with gh run view and --log-failed when a run exists. Diagnose the root cause instead of merely rerunning CI.
- Read ${task_file}, ${PLAN_FILE}, ${PROGRESS_FILE}, AGENTS instructions, and all relevant repository rules.
- Preserve unrelated work and change only files required to make ${task} and its CI checks pass.
- Run focused checks first, then every affected verification command. Keep ${PROGRESS_FILE} truthful.
- Preserve the task's single-commit requirement: amend the existing ${task} commit rather than creating another commit.
- Push the amended commit with git push --force-with-lease origin feat/web-ui.
- Do not invoke this runner or start another task. Return only after the repair is pushed, or clearly report a blocker.
EOF
)

      repair_cmd=(pi --print --approve --name "web-ui-${task}-ci-repair-${repair_attempt}" --thinking "$THINKING")
      [[ -z "$MODEL" ]] || repair_cmd+=(--model "$MODEL")
      repair_cmd+=("@${PLAN_FILE}" "@${task_file}" "@${PROGRESS_FILE}" "$repair_prompt")

      set +e
      env -u PI_SESSION_ID -u PI_SESSION_FILE -u PI_PROVIDER -u PI_MODEL \
        -u PI_REASONING_LEVEL "${repair_cmd[@]}" 2>&1 | tee -a "$log_file"
      repair_status=${PIPESTATUS[0]}
      set -e

      if (( repair_status != 0 )); then
        record_task_state "$task" "FAILED(CI_REPAIR-${repair_status})" "$log_file" \
          "Web UI task CI repair failed" \
          "$task repair $repair_attempt exited with status $repair_status (progress: $(completion_progress))"
        exit "$repair_status"
      fi
      if ! validate_progress_entry "$task"; then
        record_task_state "$task" "FAILED(CI_REPAIR-PROGRESS)" "$log_file" \
          "Web UI task CI repair not validated" \
          "$task repair $repair_attempt left an invalid progress record (progress: $(completion_progress))"
        exit 1
      fi
    done

    record_task_state "$task" "FINISHED" "$log_file" \
      "Web UI task finished" "$task completed, validated, and CI is green (progress: $(completion_progress))"
  elif (( status == 0 )); then
    record_task_state "$task" "FAILED(PROGRESS)" "$log_file" \
      "Web UI task not validated" \
      "$task did not complete its PROGRESS.md record (progress: $(completion_progress))"
    exit 1
  else
    record_task_state "$task" "FAILED(${status})" "$log_file" \
      "Web UI task failed" "$task exited with status $status (progress: $(completion_progress))"
    exit "$status"
  fi
done
