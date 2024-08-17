// expected body type for a WASM run configuration

import type { ExportedTrace } from "./trace";

// see provider.go WASMRun struct
export type WASMRun = {
  id: string;
  binary: string;
  args: string[];
  envs: string[];
  stdin?: string;
  loadfs?: string[];
  datafile?: string;
  trace: boolean;
  currentTrace?: ExportedTrace;
};

type ParametrizedRun = {
  args: string[];
  envs: string[];
  stdin: string;
  loadfs: string[];
  datafile: string;
};

export type RunConfiguration = {
  // The run ID is generated internally for reference purposes.
  runId: string;
  // Metadata about the requestor.
  // Requestor *Requestor `json:"-"`
  // The filename of the binary to use for all of these runs.
  bin: string;
  // Global environment variables that are the same for all runs.
  //! no deduplication with task envs is performed yet
  envs: string[];
  // An array of parametrized runs on the common binary.
  exec: ParametrizedRun[];
  // Enable timestamp tracing of executions.
  trace: boolean;
};
