#!/usr/bin/env bash
# run-tasks.sh — Autonomously run agent-framework tasks via Claude Code
#
# Usage:
#   ./scripts/run-tasks.sh [prompt-file] [max-runs]
#
# Examples:
#   ./scripts/run-tasks.sh                                    # auto-detect prompt file
#   ./scripts/run-tasks.sh agent-work/orcaslicer-prompt.md    # specific prompt
#   ./scripts/run-tasks.sh agent-work/orcaslicer-prompt.md 50 # with run limit
#
# Stopping:
#   The agent writes agent-work/BLOCKED.md when it needs your input.
#   The script detects this and stops. Edit BLOCKED.md with your answer,
#   then delete it and re-run the script.
#
# Requires: claude CLI (Claude Code) with Max subscription
# Run in tmux/screen so it survives terminal disconnects.

set -uo pipefail

# Ensure Ctrl-C kills child processes too
trap 'echo ""; echo "Interrupted."; kill 0 2>/dev/null; exit 130' INT TERM

BLOCKED_FILE="agent-work/BLOCKED.md"
PROMPT_FILE="${1:-}"
MAX_RUNS="${2:-100}"
LOG_DIR="agent-work/logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Auto-detect prompt file if not specified
if [ -z "$PROMPT_FILE" ]; then
  PROMPT_FILES=($(find agent-work -name '*-prompt.md' -not -name 'generator-prompt.md' -not -name 'feature-prompt.md' 2>/dev/null))
  if [ ${#PROMPT_FILES[@]} -eq 0 ]; then
    echo "Error: No prompt files found in agent-work/"
    exit 1
  elif [ ${#PROMPT_FILES[@]} -eq 1 ]; then
    PROMPT_FILE="${PROMPT_FILES[0]}"
  else
    echo "Multiple prompt files found:"
    for i in "${!PROMPT_FILES[@]}"; do
      echo "  [$i] ${PROMPT_FILES[$i]}"
    done
    echo ""
    echo "Specify one: ./scripts/run-tasks.sh <prompt-file>"
    exit 1
  fi
fi

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Error: Prompt file not found: $PROMPT_FILE"
  exit 1
fi

# Check for leftover BLOCKED.md before starting
if [ -f "$BLOCKED_FILE" ]; then
  echo "=== BLOCKED ==="
  echo "The agent has a pending question in $BLOCKED_FILE:"
  echo ""
  cat "$BLOCKED_FILE"
  echo ""
  echo "Edit the file with your answer, then delete it and re-run."
  exit 2
fi

# Extract task file path from prompt file
TASK_FILE=$(grep -oP '`(agent-work/[^`]*-tasks\.md)`' "$PROMPT_FILE" | head -1 | tr -d '`' || true)
if [ -z "$TASK_FILE" ]; then
  TASK_FILE=$(grep -oP '`(memory/[^`]*-tasks\.md)`' "$PROMPT_FILE" | head -1 | tr -d '`' || true)
fi

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/run-${TIMESTAMP}.log"

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

count_tasks() {
  local pattern="$1"
  if [ -n "$TASK_FILE" ] && [ -f "$TASK_FILE" ]; then
    local n
    n=$(grep -c "$pattern" "$TASK_FILE" 2>/dev/null) || true
    echo "${n:-0}"
  else
    echo "?"
  fi
}

count_remaining() { count_tasks '^\- \[ \]'; }
count_completed() { count_tasks '^\- \[x\]'; }
count_blocked()   { count_tasks '^\- \[?\]'; }

log "=== Task Runner Started ==="
log "Prompt:    $PROMPT_FILE"
log "Tasks:     ${TASK_FILE:-unknown}"
log "Max runs:  $MAX_RUNS"
log "Log:       $LOG_FILE"
log "Remaining: $(count_remaining) tasks"
log ""

for i in $(seq 1 "$MAX_RUNS"); do
  REMAINING=$(count_remaining)
  COMPLETED=$(count_completed)
  BLOCKED=$(count_blocked)

  if [ "$REMAINING" = "0" ] 2>/dev/null; then
    log ""
    log "=== ALL TASKS COMPLETE ==="
    log "Completed: $COMPLETED | Blocked: $BLOCKED"
    exit 0
  fi

  log "--- Run $i/$MAX_RUNS (remaining: $REMAINING, completed: $COMPLETED, blocked: $BLOCKED) ---"

  # Run claude with streaming JSON, parse in real-time with node
  claude --dangerously-skip-permissions --model opus --verbose --output-format stream-json \
    -p "SKIP the ROUTER.md — do NOT read it or load any skills. Just read $PROMPT_FILE and follow its instructions exactly. Do NOT use the Skill tool." \
    2>>"$LOG_FILE" | nix develop -c node -e '
    const rl = require("readline").createInterface({ input: process.stdin });
    const fs = require("fs");
    const logFile = process.argv[1];
    rl.on("line", (line) => {
      fs.appendFileSync(logFile, line + "\n");
      try {
        const msg = JSON.parse(line);
        if (msg.type === "assistant" && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) {
              process.stdout.write(block.text);
            } else if (block.type === "tool_use") {
              const inp = block.input || {};
              let detail = "";
              if (block.name === "Bash") detail = inp.command || "";
              else if (block.name === "WebFetch") detail = inp.url || "";
              else if (block.name === "WebSearch") detail = inp.query || "";
              else if (block.name === "Read") detail = inp.file_path || "";
              else if (block.name === "Write") detail = inp.file_path || "";
              else if (block.name === "Edit") detail = inp.file_path || "";
              else if (block.name === "Glob") detail = inp.pattern || "";
              else if (block.name === "Grep") detail = inp.pattern || "";
              else if (block.name === "Agent") detail = inp.description || "";
              else detail = JSON.stringify(inp).slice(0, 120);
              process.stdout.write(`\n[${block.name}] ${detail}\n`);
            }
          }
        } else if (msg.type === "result") {
          if (msg.result) process.stdout.write("\n" + msg.result + "\n");
          process.exit(msg.is_error ? 1 : 0);
        }
      } catch {}
    });
    rl.on("close", () => process.exit(0));
  ' "$LOG_FILE"

  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ]; then
    log "Run $i completed successfully"
  else
    log "Run $i exited with code $EXIT_CODE"
    if [ $EXIT_CODE -gt 1 ]; then
      log "Unexpected exit code $EXIT_CODE, stopping."
      break
    fi
    # exit code 1 = non-fatal, continue to next run
  fi

  # Check if agent wrote BLOCKED.md (needs user input)
  if [ -f "$BLOCKED_FILE" ]; then
    log ""
    log "=== BLOCKED — Agent needs your input ==="
    log ""
    cat "$BLOCKED_FILE" | tee -a "$LOG_FILE"
    log ""
    log "Edit $BLOCKED_FILE with your answer, delete it, then re-run."
    exit 2
  fi

  sleep 2
done

log ""
log "=== Runner finished after $MAX_RUNS runs ==="
log "Remaining: $(count_remaining) | Completed: $(count_completed) | Blocked: $(count_blocked)"
