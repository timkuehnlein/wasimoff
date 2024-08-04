import { Calls } from "@/fn/calls";
import { borrower, borrowerForRemote } from "@/fn/pullUtilities";
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

export type SchedulerStore = {
  schedule(configuration: RunConfiguration): Promise<void>;
  registerRemoteBorrower(
    queue: Duplex<
      AsyncGenerator<Uint8ArrayList>,
      Source<Uint8ArrayList | Uint8Array>,
      Promise<void>
    >
  ): void;
  registerLocalBorrowers(): void;
};

/** The scheduler store abstracts away the details of the work queuing. */
export const useScheduler = defineStore<string, SchedulerStore>(
  "Scheduler",
  () => {
    const prefix = ["%c Scheduler ", "background: skyblue; color: black;"];

    // use the worker pool needed to execute WASM
    const pool = useWorkerPool();
    // hold queue of tasks
    const queue = new PushableQueue<WASMRun>();
    // stream lender
    const lender = lendStream<WASMRun, CompletedExecution>();

    // console sink
    const stringSink: Sink<Source<CompletedExecution>, Promise<void>> = async (
      source
    ) => {
      for await (const completedExecution of source) {
        console.log(
          "Result",
          completedExecution.context,
          completedExecution.exitcode === 0 ? "SUCCESS" : "ERROR"
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
        map<WASMRun, WASMRun>(s, (x) => {
          console.log("sending", x);
          return x;
        }),
      // toIteratorTransform(pullPipe),
      (source) => toIterator(pullPipe(toPull(source))),
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
          pool.count
        )
      );
      console.log(...prefix, `${pool.count} local borrowers active`);
    }

    async function schedule(configuration: RunConfiguration): Promise<void> {
      const tasks = await populateTasks(configuration);
      tasks.forEach((task) => queue.push(task));
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
        borrowerForRemote<WASMRun, CompletedExecution>(borrower, 2)
      );
    };

    return {
      schedule,
      registerRemoteBorrower,
      registerLocalBorrowers,
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
