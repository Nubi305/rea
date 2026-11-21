#!/usr/bin/env bash
# Control script for the application served on 127.0.0.1.
#   ctl.sh start   start it; refuses when the port is already taken
#   ctl.sh stop    stop it and verify the port is free
#   ctl.sh reset   stop, then start: all data returns to the seed; returns once the new process answers
#   ctl.sh health  exit 0 when it answers, 1 otherwise
# PORT (default 5340) selects the port. The serving process writes its own pid file once it holds
# the port, and every pid is checked against the process's command line and environment before use.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PORT="${PORT:-5340}"
HOST=127.0.0.1
RUN_DIR="$DIR/.run"
PID_FILE="$RUN_DIR/server-$PORT.pid"
LOG_FILE="$RUN_DIR/server-$PORT.log"
SERVER="$DIR/server.mjs"

port_open() {
  (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null
}

answers() {
  local line
  exec 3<>"/dev/tcp/$HOST/$PORT" || return 1
  printf 'GET /api/health HTTP/1.0\r\nHost: %s\r\n\r\n' "$HOST:$PORT" >&3
  IFS= read -r -t 3 line <&3 || { exec 3>&- 3<&-; return 1; }
  exec 3>&- 3<&-
  case "$line" in
    "HTTP/1.1 200"*|"HTTP/1.0 200"*) return 0 ;;
    *) return 1 ;;
  esac
}

# A pid is ours only when it runs this server file and carries this port's pid-file marker.
is_ours() {
  local pid="$1"
  [ -n "$pid" ] && [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\0' '\n' <"/proc/$pid/cmdline" 2>/dev/null | grep -qxF "$SERVER" || return 1
  tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qxF "BRASSNOOK_PID_FILE=$PID_FILE" || return 1
}

# Every live process that is ours, found from the pid file and from a scan of /proc.
our_pids() {
  local pid dir
  {
    if [ -f "$PID_FILE" ]; then
      pid="$(tr -cd '0-9' <"$PID_FILE")"
      is_ours "$pid" && echo "$pid"
    fi
    for dir in /proc/[0-9]*; do
      pid="${dir#/proc/}"
      is_ours "$pid" 2>/dev/null && echo "$pid"
    done
  } | sort -un
}

do_health() {
  local pids
  if answers 2>/dev/null; then
    pids="$(our_pids | tr '\n' ' ')"
    if [ -z "$pids" ]; then
      echo "port $PORT answers but the process is not this application's" >&2
      return 1
    fi
    echo "ok http://$HOST:$PORT pid ${pids% }"
    return 0
  fi
  echo "not answering on http://$HOST:$PORT" >&2
  return 1
}

do_start() {
  local pid tries
  if port_open; then
    pid="$(our_pids | tr '\n' ' ')"
    if [ -n "$pid" ]; then
      echo "refusing to start: already running on port $PORT, pid ${pid% }" >&2
    else
      echo "refusing to start: port $PORT is taken by another process" >&2
    fi
    return 1
  fi
  if [ -n "$(our_pids)" ]; then
    echo "refusing to start: a previous process is still alive; run '$0 stop' first" >&2
    return 1
  fi
  mkdir -p "$RUN_DIR"
  rm -f "$PID_FILE"
  BRASSNOOK_PID_FILE="$PID_FILE" PORT="$PORT" setsid nohup node "$SERVER" >>"$LOG_FILE" 2>&1 </dev/null &
  tries=0
  while [ "$tries" -lt 100 ]; do
    if [ -f "$PID_FILE" ]; then
      pid="$(tr -cd '0-9' <"$PID_FILE")"
      if is_ours "$pid" && answers 2>/dev/null; then
        echo "started http://$HOST:$PORT pid $pid"
        return 0
      fi
    fi
    sleep 0.1
    tries=$((tries + 1))
  done
  echo "start failed: no answer on port $PORT after 10 s; see $LOG_FILE" >&2
  do_stop >/dev/null 2>&1
  return 1
}

do_stop() {
  local pids pid tries
  pids="$(our_pids)"
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null
  done
  for pid in $pids; do
    tries=0
    while kill -0 "$pid" 2>/dev/null && [ "$tries" -lt 50 ]; do
      sleep 0.1
      tries=$((tries + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null
      sleep 0.2
    fi
  done
  rm -f "$PID_FILE"
  tries=0
  while port_open && [ "$tries" -lt 50 ]; do
    sleep 0.1
    tries=$((tries + 1))
  done
  if port_open; then
    echo "stop failed: port $PORT is still taken, and not by this application" >&2
    return 1
  fi
  if [ -n "$(our_pids)" ]; then
    echo "stop failed: a process survived" >&2
    return 1
  fi
  if [ -n "$pids" ]; then
    echo "stopped pid $(echo $pids); port $PORT is free"
  else
    echo "not running; port $PORT is free"
  fi
  return 0
}

case "${1:-}" in
  start) do_start ;;
  stop) do_stop ;;
  reset) do_stop && do_start ;;
  health) do_health ;;
  *)
    echo "usage: $0 start|stop|reset|health" >&2
    exit 2
    ;;
esac
