#!/usr/bin/env bash
# remote start line and rename labels + append colours
set -eu

sed \
  -e 's/step_ms;label/&;colour/' \
  -e '/local: start/d' \
  -e 's/local: decoded/decode configuration;1/' \
  -e 's/local: queued/queue task;1/' \
  -e 's/local: selected from queue/select from queue;1/' \
  -e 's/rpc: function top/transmit to peer;1/' \
  -e 's/rpc: pool.exec got a worker/get a Worker;4/' \
  -e 's/worker: function top/transmit task;4/' \
  -e 's/worker: commandline logged/log arguments;4/' \
  -e 's/worker: filesystem prepared/prepare filesystem;4/' \
  -e 's/worker: wasm module compiled/get cached module;4/' \
  -e 's/worker: wasi shim prepared/prepare WASI shim;4/' \
  -e 's/worker: module instantiated/instantiate module;4/' \
  -e 's/worker: task completed/execute task;4/' \
  -e 's/local: completed/respond to peer;1/' \
  -e 's/total/total;6/' \
  "$@"