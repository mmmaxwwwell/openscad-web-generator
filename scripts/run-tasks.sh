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

BLOCKED_FILE="agent-work/BLOCKED.md"
PROMPT_FILE="${1:-}"
MAX_RUNS="${2:-100}"
LOG_DIR="agent-work/logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
CONSECUTIVE_FAILURES=0
MAX_CONSECUTIVE_FAILURES=3
CONSECUTIVE_NOOP=0
MAX_CONSECUTIVE_NOOP=5         # Stop after 5 runs with no task progress
PREV_COMPLETED=""
BASE_BACKOFF=60        # 1 minute base backoff
MAX_BACKOFF=1800       # 30 minute max backoff (Max plan resets are ~5-15 min)
STDERR_FILE=$(mktemp)
RATE_LIMIT_FILE=$(mktemp)
CLAUDE_PID=""

# Ctrl-C handler: kill claude and all children, then exit
cleanup() {
  rm -f "$STDERR_FILE" "$RATE_LIMIT_FILE" 2>/dev/null
}

terminate() {
  echo ""
  echo "Interrupted."
  # Kill the claude process and its process group if running
  if [ -n "$CLAUDE_PID" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then
    kill -TERM -- -"$CLAUDE_PID" 2>/dev/null || kill -TERM "$CLAUDE_PID" 2>/dev/null
    wait "$CLAUDE_PID" 2>/dev/null
  fi
  # Kill any remaining children
  kill -- -$$ 2>/dev/null
  cleanup
  exit 130
}

trap terminate INT TERM
trap cleanup EXIT

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
# Also try bare filename (no directory prefix) and search for it
if [ -z "$TASK_FILE" ]; then
  BARE=$(grep -oP '`([^`/]*-tasks\.md)`' "$PROMPT_FILE" | head -1 | tr -d '`' || true)
  if [ -n "$BARE" ]; then
    for dir in agent-work memory; do
      if [ -f "$dir/$BARE" ]; then
        TASK_FILE="$dir/$BARE"
        break
      fi
    done
  fi
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

RUN_NUM=0
while [ $RUN_NUM -lt "$MAX_RUNS" ]; do
  RUN_NUM=$((RUN_NUM + 1))
  REMAINING=$(count_remaining)
  COMPLETED=$(count_completed)
  BLOCKED=$(count_blocked)

  if [ "$REMAINING" = "0" ] 2>/dev/null; then
    log ""
    log "=== ALL TASKS COMPLETE ==="
    log "Completed: $COMPLETED | Blocked: $BLOCKED"
    exit 0
  fi

  log "--- Run $RUN_NUM/$MAX_RUNS (remaining: $REMAINING, completed: $COMPLETED, blocked: $BLOCKED) ---"

  RUN_START=$(date +%s)

  # Run claude with streaming JSON, parse in real-time with node
  # Use a FIFO so we can capture claude's PID for signal handling
  > "$STDERR_FILE"
  > "$RATE_LIMIT_FILE"
  FIFO=$(mktemp -u)
  mkfifo "$FIFO"

  claude --dangerously-skip-permissions --model opus --verbose --output-format stream-json \
    -p "SKIP the ROUTER.md — do NOT read it or load any skills. Just read $PROMPT_FILE and follow its instructions exactly. Do NOT use the Skill tool." \
    2> >(tee -a "$LOG_FILE" >> "$STDERR_FILE") > "$FIFO" &
  CLAUDE_PID=$!

  nix develop -c node -e '
    const rl = require("readline").createInterface({ input: process.stdin });
    const fs = require("fs");
    const logFile = process.argv[1];
    const rateLimitFile = process.argv[2];
    let gotContent = false;
    rl.on("line", (line) => {
      fs.appendFileSync(logFile, line + "\n");
      try {
        const msg = JSON.parse(line);
        if (msg.type === "rate_limit_event") {
          const info = msg.rate_limit_info || {};
          // Write rate limit info for the bash script to read
          fs.writeFileSync(rateLimitFile, JSON.stringify({
            status: info.status,
            resetsAt: info.resetsAt,
            rateLimitType: info.rateLimitType,
            overageStatus: info.overageStatus,
            overageResetsAt: info.overageResetsAt,
            isUsingOverage: info.isUsingOverage
          }) + "\n");
          if (info.status && info.status !== "allowed") {
            process.stderr.write("RATE_LIMITED: resets at " + new Date(info.resetsAt * 1000).toLocaleTimeString() + "\n");
            process.exit(3);  // Special exit code for rate limit
          }
        } else if (msg.type === "assistant" && msg.message?.content) {
          gotContent = true;
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
        } else if (msg.type === "error") {
          const errMsg = msg.error?.message || msg.message || JSON.stringify(msg);
          process.stderr.write("CLAUDE_ERROR: " + errMsg + "\n");
          process.exit(2);
        } else if (msg.type === "result") {
          if (msg.result) process.stdout.write("\n" + msg.result + "\n");
          process.exit(msg.is_error ? 1 : 0);
        }
      } catch {}
    });
    rl.on("close", () => {
      // If we got no content at all, likely a pre-conversation error (usage limit)
      if (!gotContent) process.exit(2);
      process.exit(0);
    });
  ' "$LOG_FILE" "$RATE_LIMIT_FILE" < "$FIFO"

  EXIT_CODE=$?
  wait "$CLAUDE_PID" 2>/dev/null || true
  CLAUDE_PID=""
  rm -f "$FIFO"
  STDERR_CONTENT=$(cat "$STDERR_FILE" 2>/dev/null || true)

  # Parse rate limit info from the stream (written by the node parser)
  RESETS_AT=""
  if [ -s "$RATE_LIMIT_FILE" ]; then
    RESETS_AT=$(nix develop -c node -e '
      const fs = require("fs");
      try {
        const info = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
        if (info.resetsAt) process.stdout.write(String(info.resetsAt));
      } catch {}
    ' "$RATE_LIMIT_FILE" 2>/dev/null || true)
  fi

  # Determine if rate limited: exit code 3 (from node parser), or heuristics
  USAGE_LIMITED=false
  if [ $EXIT_CODE -eq 3 ]; then
    USAGE_LIMITED=true
  elif echo "$STDERR_CONTENT" | grep -qiE 'rate.?limit|usage.?limit|too many|429|quota|capacity|overloaded|busy|try again'; then
    USAGE_LIMITED=true
  elif [ $EXIT_CODE -eq 2 ] && [ $EXIT_CODE -ne 130 ] && ! echo "$STDERR_CONTENT" | grep -q "CLAUDE_ERROR"; then
    # No content received, likely a pre-conversation rate limit
    USAGE_LIMITED=true
  fi

  if [ $EXIT_CODE -eq 0 ]; then
    RUN_END=$(date +%s)
    RUN_DURATION=$(( RUN_END - RUN_START ))
    log "Run $RUN_NUM completed successfully (${RUN_DURATION}s)"
    CONSECUTIVE_FAILURES=0

    # Detect no-op runs: task count didn't change after a successful run
    POST_COMPLETED=$(count_completed)
    if [ "$POST_COMPLETED" = "?" ]; then
      # Can't track progress — count as no-op if run was fast (< 30s)
      if [ $RUN_DURATION -lt 30 ]; then
        CONSECUTIVE_NOOP=$((CONSECUTIVE_NOOP + 1))
        log "⚠️  Fast no-op run (${RUN_DURATION}s, no task tracking). Consecutive: $CONSECUTIVE_NOOP/$MAX_CONSECUTIVE_NOOP"
      else
        CONSECUTIVE_NOOP=0
      fi
    elif [ -n "$PREV_COMPLETED" ] && [ "$POST_COMPLETED" = "$PREV_COMPLETED" ]; then
      CONSECUTIVE_NOOP=$((CONSECUTIVE_NOOP + 1))
      log "⚠️  No task progress (completed still $POST_COMPLETED). Consecutive: $CONSECUTIVE_NOOP/$MAX_CONSECUTIVE_NOOP"
    else
      CONSECUTIVE_NOOP=0
    fi
    PREV_COMPLETED="$POST_COMPLETED"

    if [ $CONSECUTIVE_NOOP -ge $MAX_CONSECUTIVE_NOOP ]; then
      log ""
      log "=== STOPPED — $MAX_CONSECUTIVE_NOOP consecutive runs with no task progress ==="
      log "Agent may be stuck or all tasks are done but task file can't be found."
      log "Remaining: $(count_remaining) | Completed: $(count_completed) | Blocked: $(count_blocked)"
      exit 3
    fi
  elif [ "$USAGE_LIMITED" = true ]; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))

    # Use resetsAt timestamp if available, otherwise fall back to exponential backoff
    if [ -n "$RESETS_AT" ]; then
      NOW=$(date +%s)
      BACKOFF=$(( RESETS_AT - NOW ))
      # Add 10s buffer to avoid hitting the limit boundary
      if [ $BACKOFF -gt 0 ]; then
        BACKOFF=$(( BACKOFF + 10 ))
      fi
      # Sanity bounds: at least 30s, at most 6 hours
      if [ $BACKOFF -lt 30 ]; then BACKOFF=30; fi
      if [ $BACKOFF -gt 21600 ]; then BACKOFF=21600; fi
      BACKOFF_MIN=$(( BACKOFF / 60 ))
      RESUME_TIME=$(date -d "@$((RESETS_AT + 10))" '+%H:%M:%S' 2>/dev/null || date -r "$((RESETS_AT + 10))" '+%H:%M:%S' 2>/dev/null || echo "~${BACKOFF_MIN}min")
      log "⏳ Rate limited (resets at $RESUME_TIME). Sleeping ${BACKOFF_MIN}min..."
    else
      # Fallback: exponential backoff when no resetsAt available
      BACKOFF=$(( BASE_BACKOFF * (2 ** (CONSECUTIVE_FAILURES - 1)) ))
      if [ $BACKOFF -gt $MAX_BACKOFF ]; then
        BACKOFF=$MAX_BACKOFF
      fi
      BACKOFF_MIN=$(( BACKOFF / 60 ))
      RESUME_TIME=$(date -d "+${BACKOFF} seconds" '+%H:%M:%S' 2>/dev/null || date -v+${BACKOFF}S '+%H:%M:%S' 2>/dev/null || echo "~${BACKOFF_MIN}min")
      log "⏳ Usage limit hit (attempt $CONSECUTIVE_FAILURES, no reset time). Waiting ${BACKOFF_MIN}min (until ~$RESUME_TIME)..."
    fi
    if echo "$STDERR_CONTENT" | head -5 | grep -qiE 'rate|limit|usage|429|quota|capacity' ; then
      log "  Error detail: $(echo "$STDERR_CONTENT" | grep -iE 'rate|limit|usage|429|quota|capacity' | head -1)"
    fi
    # Sleep in 1s increments so Ctrl-C is responsive
    SLEPT=0
    while [ $SLEPT -lt "$BACKOFF" ]; do
      sleep 1
      SLEPT=$((SLEPT + 1))
    done
    log "Resuming after backoff..."
    RUN_NUM=$((RUN_NUM - 1))  # Don't count usage-limited runs against MAX_RUNS
    continue
  else
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    log "Run $RUN_NUM exited with code $EXIT_CODE (consecutive failures: $CONSECUTIVE_FAILURES)"
    if [ $CONSECUTIVE_FAILURES -ge $MAX_CONSECUTIVE_FAILURES ]; then
      log "⚠️  $MAX_CONSECUTIVE_FAILURES consecutive failures. Likely persistent issue."
      log "Waiting ${BASE_BACKOFF}s before retrying in case it's a transient usage limit..."
      SLEPT=0
      while [ $SLEPT -lt "$BASE_BACKOFF" ]; do
        sleep 1
        SLEPT=$((SLEPT + 1))
      done
      CONSECUTIVE_FAILURES=0  # Reset and give it another chance
    fi
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
log "=== Runner finished after $RUN_NUM runs ==="
log "Remaining: $(count_remaining) | Completed: $(count_completed) | Blocked: $(count_blocked)"
