import type { AdvancedExecutionOptions, CompletedExecution, WASMRunner } from "@/worker/wasmrunner";
import type { WASMRun } from "./types";
import { proxy, type Remote } from "comlink";
import { Trace } from "./trace";

export type MinimalWorkerPoolStore = {
  exec: <Result>(task: (worker: Remote<WASMRunner>) => Promise<Result>, next?: () => void) => Promise<Result>;
};

export namespace Calls {

/** Execute a stored WASI executable via the /run endpoint in Broker. */
export async function run(body: any, next: () => void, pool: MinimalWorkerPoolStore): Promise<CompletedExecution> {
    // expected body type
    let { id, binary, args, envs, stdin, loadfs, datafile, trace } =
      body as WASMRun;
    // maybe start a trace
    let tracer: Trace | undefined;
    if (trace === true) tracer = new Trace("rpc: function top");
    // undefined slices get encoded as `null` in Go
    if (args === null) args = [];
    if (envs === null) envs = [];
    if (loadfs === null) loadfs = [];
    // assembly advanced options
    let options: AdvancedExecutionOptions = {};
    // preload files under exactly their names in OPFS storage, as a simplification
    if (loadfs)
      options.rootfs = loadfs.reduce((o, v) => {
        o[v] = v;
        return o;
      }, {} as { [k: string]: string });
    if (datafile) options.datafile = datafile;
    if (stdin) options.stdin = stdin;
    tracer?.now("rpc: parsed options");
    return await pool.exec(async (worker) => {
      tracer?.now("rpc: pool.exec got a worker");
      return await worker.run(
        id,
        binary,
        [binary, ...args],
        envs,
        options,
        trace ? proxy(tracer!) : undefined
      );
    }, next);
  }
}