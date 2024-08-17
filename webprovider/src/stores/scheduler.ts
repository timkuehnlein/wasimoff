import { Calls } from "@/fn/calls";
import { borrower, borrowerForRemote } from "@/fn/pullUtilities";
import { exportTracesToFile, Trace, type ExportedTrace } from "@/fn/trace";
import type { RunConfiguration, WASMRun } from "@/fn/types";
import { PushableQueue } from "@/queue/pushableQueue";
import { useWorkerPool } from "@/stores/workerpool";
import type { CompletedExecution } from "@/worker/wasmrunner";
import toPull from "async-iterator-to-pull-stream";
import map from "it-map";
import { pipe } from "it-pipe";
import type { Duplex, Sink, Source } from "it-stream-types";
import { defineStore } from "pinia";
import lendStream from "pull-lend-stream";
import pull, { type Through } from "pull-stream";
import toIterator from "pull-stream-to-async-iterator";
import type { Uint8ArrayList } from "uint8arraylist";
import { useConfiguration } from "./configuration";

export type SchedulerStore = {
  schedule(configuration: RunConfiguration, tracer?: Trace): Promise<void>;
  registerRemoteBorrower(
    queue: Duplex<
      AsyncGenerator<Uint8ArrayList>,
      Source<Uint8ArrayList | Uint8Array>,
      Promise<void>
    >
  ): void;
  registerLocalBorrowers(): void;
  getTraces(): Array<{
    trace: ExportedTrace;
    context?: "remote" | "local";
  }>;
};

/** The scheduler store abstracts away the details of the work queuing. */
export const useScheduler = defineStore<string, SchedulerStore>(
  "Scheduler",
  () => {
    const prefix = ["%c Scheduler ", "background: skyblue; color: black;"];

    // use the worker pool needed to execute WASM
    const pool = useWorkerPool();
    // use the configuration
    const config = useConfiguration();
    // hold queue of tasks
    const queue = new PushableQueue<{ run: WASMRun; tracer?: Trace }>();
    // stream lender
    const lender = lendStream<WASMRun, CompletedExecution>();

    // var evaluationLoopCount: number | null = config.loop;
    var evaluationLoopCount: number | null = 64;

    var currentTraces: Array<{
      trace: ExportedTrace;
      context?: "remote" | "local";
    }> = [];

    function getTraces(): Array<{
      trace: ExportedTrace;
      context?: "remote" | "local";
    }> {
      const traces = currentTraces;
      clearTraces();
      return traces;
    }

    function clearTraces(): void {
      currentTraces = [];
    }

    // console sink
    const stringSink: Sink<Source<CompletedExecution | undefined>, Promise<void>> = async (
      source
    ) => {
      for await (const completedExecution of source) {
        console.log(
          "Result",
          completedExecution?.context,
          completedExecution?.exitcode === 0 ? "SUCCESS" : "ERROR",
          completedExecution?.trace
        );
      }
    };

    // pull (lender works with pull streams)
    const pullPipe: Through<WASMRun, CompletedExecution> = (
      source: pull.PossibleSource<WASMRun>
    ) =>
      pull(
        source,
        // optional transform
        lender
        // optional transform
      );

    // iterable, hightest level
    pipe(
      queue.queue,
      (s) =>
        map<{ run: WASMRun; tracer?: Trace }, WASMRun>(
          s,
          async ({ run, tracer }) => {
            // console.log("sending", run);
            if (tracer) {
              await tracer.now("local: selected from queue");
              run.currentTrace = await tracer.export();
            }
            return run;
          }
        ),
      // toIteratorTransform(pullPipe),
      (source) => toIterator(pullPipe(toPull(source))),
      (source) =>
        map<CompletedExecution, CompletedExecution>(source, async (ce) => {
          if (!ce.trace) return ce;

          const trace = new Trace("local: completed");
          const fullTrace = await trace.export(ce.trace);

          currentTraces.push({ trace: fullTrace, context: ce.context });
          return ce;
        }),
      (source) =>
        map(source, async (ce) => {
          if (evaluationLoopCount == null) return ce;

          if (evaluationLoopCount > 0) {
            // add new task to the queue
            const configuration: RunConfiguration = JSON.parse(
              `{ "bin": "tsp.wasm", "trace": true, "exec": [{ "args": ["rand", "11"] }] }`
            );
            const tracer = new Trace("local: start");
            schedule(configuration, tracer);

            evaluationLoopCount--;
          } else {
            const traces = getTraces();
            if (traces.length === 0) {
              console.error("No traces available.");
              return;
            }
            exportTracesToFile(traces, "traces");
            evaluationLoopCount = null;
          }

          return ce;
        }),
      stringSink
    );

    // todo: batchsize does not make sense yet, as the stream is worked on iteratively
    function registerLocalBorrowers(): void {
      // borrow a substream to be handled locally
      lender.lendStream(
        borrower(
          async (run: WASMRun, cb: pull.SourceCallback<CompletedExecution>) => {
            try {
              const result = await Calls.run(run, () => {}, pool);
              result.context = "local";
              cb(null, result);
            } catch (e) {
              console.log(...prefix, "Error in local pool execution: ", e, run);
              if (e instanceof Error) {
                cb(e);
              } else {
                cb(
                  new Error(
                    `Error in local pool execution (unknown); Run: ${JSON.stringify(
                      run
                    )}`
                  )
                );
              }
            }
          },
          // pool.count
          1
        )
      );
      console.log(...prefix, `${pool.count} local borrowers active`);
    }

    async function schedule(
      configuration: RunConfiguration,
      tracerA?: Trace
    ): Promise<void> {
      const tasks = await populateTasks(configuration);
      tasks.forEach(async (task) => {
        var tracer: Trace | undefined;
        if (configuration.trace && !tracerA) {
          tracer = new Trace("local: decoded");
        }
        tracerA?.now("local: decoded");
        queue.push({ run: task, tracer: tracer ?? tracerA });
      });
    }

    const registerRemoteBorrower = (
      borrower: Duplex<
        AsyncGenerator<Uint8ArrayList>,
        Source<Uint8ArrayList | Uint8Array>,
        Promise<void>
      >
    ) => {
      // borrow a substream to be handled by a remote worker
      lender.lendStream(
        borrowerForRemote<WASMRun, CompletedExecution>(borrower, 1, 0)
      );
    };

    return {
      schedule,
      registerRemoteBorrower,
      registerLocalBorrowers,
      getTraces,
    };
  }
);

// could be scheduled as well
async function populateTasks(
  configuration: RunConfiguration
): Promise<WASMRun[]> {
  const tasks: WASMRun[] = [];
  configuration.exec.forEach((exec, index) => {
    const envs = exec.envs ?? [];
    const configEnvs = configuration.envs ?? [];

    // assemble the task
    const task: WASMRun = {
      id: configuration.runId + index,
      binary: configuration.bin,
      args: exec.args,
      envs: envs.concat(configEnvs),
      stdin: exec.stdin,
      loadfs: exec.loadfs ?? [],
      datafile: exec.datafile,
      trace: configuration.trace,
    };
    tasks.push(task);
  });

  return tasks;
}
