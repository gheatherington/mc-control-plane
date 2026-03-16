#!/usr/bin/env bash
set -euo pipefail

container_name="${MC_CONTAINER_NAME:-forge-minecraft-server}"

require_arg() {
  if [ "$#" -lt 1 ]; then
    echo "missing action" >&2
    exit 1
  fi
}

docker_json() {
  docker inspect "$container_name"
}

status() {
  docker inspect "$container_name" --format '{{json .State}}'
}

start_server() {
  docker start "$container_name"
}

stop_server() {
  docker stop "$container_name"
}

restart_server() {
  docker restart "$container_name"
}

logs_tail() {
  local lines="${1:-100}"
  docker logs --tail "$lines" "$container_name"
}

rcon() {
  if [ "$#" -lt 1 ]; then
    echo "missing rcon command" >&2
    exit 1
  fi

  docker exec "$container_name" rcon-cli "$@"
}

require_arg "$@"
action="$1"
shift

case "$action" in
  status)
    status
    ;;
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    restart_server
    ;;
  logs-tail)
    logs_tail "$@"
    ;;
  rcon)
    rcon "$@"
    ;;
  *)
    echo "unknown action: $action" >&2
    exit 1
    ;;
esac
