#!/bin/sh
# Host bind mounts for data/ and workspace/ are often root-owned (Docker creates
# them, or git checkout leaves them as the deploy user). The app runs as uid 10001.
set -eu

mkdir -p \
  /app/data/blackboard \
  /app/workspace/artigos \
  /app/workspace/pautas \
  /app/workspace/aprovacoes \
  /app/workspace/publicacao \
  /app/workspace/publicacoes \
  /app/workspace/pesquisas

if ! gosu office /usr/bin/test -w /app/data || ! gosu office /usr/bin/test -w /app/workspace; then
  chown -R office:office /app/data /app/workspace
fi

exec gosu office "$@"
