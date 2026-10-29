#!/bin/bash
# Single-run guard for the disposable-stack e2e gate scripts (sourced, not executed).
#
# Each gate derives its build directory, docker compose project and ports from the
# checkout path alone, and its startup tears down whatever it finds under those names
# on the assumption that a previous run was interrupted. Without a guard, a second
# invocation in the same checkout while the first is still alive destroys the first
# run's containers and build directory.
#
# gate_run_lock <lock-file> <label> takes an exclusive, non-blocking flock on
# <lock-file> (held on fd 9 for the life of the calling shell and inherited by its
# children, so it is released by the kernel when the run and its process tree exit,
# however they exit; a PID file could go stale, a flock cannot). When the lock is
# already held it prints who holds it and exits 1 BEFORE any teardown happens, so the
# caller must call it before installing its cleanup trap.
#
# The lock file sits next to the build directory, not inside it (the build directory
# is removed during startup and cleanup). It is git-ignored (.generated-*.lock).

gate_run_lock() {
  local lock_file="$1" label="$2"
  if ! command -v flock >/dev/null 2>&1; then
    echo "$label: flock is required to guard against concurrent runs in this checkout." >&2
    exit 1
  fi
  exec 9>>"$lock_file"
  if ! flock -n 9; then
    echo "$label: another run is still active in this checkout (lock $lock_file); refusing to tear down its stack." >&2
    echo "$label: wait for it to finish, or stop it first, then rerun." >&2
    exit 1
  fi
  : > "$lock_file"
  printf '%s\n' "$$" >&9
}
