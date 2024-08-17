<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { RunConfiguration } from "@/fn/types";

// terminal for logging
import { useTerminal, LogType } from "@/stores/terminal";
const terminal = useTerminal();

// configuration via url fragment
import { useConfiguration } from "@/stores/configuration";
const conf = useConfiguration();

// filesystem storage
import { useFilesystem } from "@/stores/filesystem";
const opfs = useFilesystem();

// webassembly runner worker pool
import { useWorkerPool } from "@/stores/workerpool";
const pool = useWorkerPool();

// scheduler for running tasks
import { useScheduler } from "@/stores/scheduler";
import { exportTracesToFile, Trace } from "@/fn/trace";
const scheduler = useScheduler();

import { useConnection, type ConnectionStore } from "@/stores";
import { storeToRefs } from "pinia";
const connection = useConnection();
const { connected } = storeToRefs(connection)

// run automatically?
if (conf.autoconnect) {
  // connection.$subscribe((mutation , state) => {
  //   if (state.connected) {
  //     runSingle();
  //   }
  // });

  // watch(connection, async (connection) => {
  //   console.log("connection CHANGED", connection);
  //   if (connection.connected) {
  //     await runSingle();
  //   }
  // });
  watch(connected, async (connected) => {
    console.log("connected CHANGED", connected);
    if (connected) {
      await runSingle();
    }
  });
}


const wasmFile = ref<File | null>();
const jsonFile = ref<File | null>();
const jsonFiles = ref<string[]>([]);
const selectedJsonFile = ref<string | null>(null);
const decoder = new TextDecoder();
const trace = ref(true);

// initially fill json file list
updateJsonFileList();

function onWasmFileChanged($event: Event) {
  const target = $event.target as HTMLInputElement;
  if (target && target.files) {
    wasmFile.value = target.files[0];
  }
}

function onJsonFileChanged($event: Event) {
  const target = $event.target as HTMLInputElement;
  if (target && target.files) {
    jsonFile.value = target.files[0];
  }
}

async function saveFile(file: File | null | undefined) {
  if (file) {
    opfs.store(await file.arrayBuffer(), file.name).then(() => {
      terminal.success(`Stored file: ${file.name}`);
    }).catch(err => {
      terminal.error(String(err));
    });
  }
}

async function updateJsonFileList(): Promise<void> {
  const files = await opfs.ls();
  jsonFiles.value = files.filter(f => f.type === "application/json").map(f => f.name);
}

async function run() {
  if (selectedJsonFile.value == null) {
    terminal.error("No JSON configuration file selected.");
    return;
  }

  const text = await opfs.getBuffer(selectedJsonFile.value);
  const configuration: RunConfiguration = JSON.parse(decoder.decode(text));

  if (trace.value) {
    configuration.trace = true;
  }

  scheduler.schedule(configuration);
}

async function runSingle() {
  const configuration: RunConfiguration = JSON.parse(`{ "bin": "tsp.wasm", "trace": true, "exec": [{ "args": ["rand", "11"] }] }`);

  const tracer = new Trace("local: start");

  scheduler.schedule(configuration, tracer);
}

function downloadTraces() {
  const traces = scheduler.getTraces();
  if (traces.length === 0) {
    terminal.error("No traces available.");
    return;
  }

  exportTracesToFile(traces, selectedJsonFile.value?.replace(".json", "") ?? "traces");
}


// ---------- OOM TESTING ---------- //

const showOOMtest = false;

// start a large number of `tsp.wasm` modules to try to trigger OOMs
async function runloadtesting(iterations: number = 1000) {
  terminal.success(`START LOCAL LOAD TESTING with ${iterations} iterations.`);

  // get the binary from OPFS and precompile a module
  const wasm = await opfs.getWasmModule("tsp.wasm");

  let t0 = performance.now(); // calculate how long it took
  let ooms = 0; // count the number of OOMs that surfaced
  let tasks: Promise<void>[] = []; // collect tasks to properly await

  // start lots of tasks asynchronously and await them all
  for (let count = 0; count < iterations; count++) {
    await new Promise<void>(async next => {
      let task = pool.exec(async worker => {
        try {
          await worker.run(String(count), wasm, ["tsp", "rand", "8"], [], undefined, undefined, undefined, true);
        } catch (err) {
          console.error("oops:", err);
          // just wait for OOM errors
          if (String(err).includes("Out of memory")) {
            ooms++;
          } else {
            terminal.error(String(err));
            throw err;
          };
        };
      }, next);
      tasks.push(task);
    });
  };
  await Promise.allSettled(tasks);

  // log the results
  let ms = (performance.now() - t0).toFixed(3);
  terminal.info(`Done in ${ms} ms. OOM'd ${ooms} times.`);
};

</script>

<template>
  <!-- worker pool controls -->
  <div class="columns">

    <!-- form input for the number of workers -->
    <div class="column">

      <label class="label has-text-grey-dark">Upload</label>
      <div class="field">
        <div class="file has-name is-info">
          <label class="file-label">
            <input class="file-input" type="file" accept="application/wasm" @change="onWasmFileChanged($event)" />
            <span class="file-cta" title="Upload Wasm binary">
              <span class="file-label">Upload a file</span>
            </span>
            <span class="file-name">{{ wasmFile?.name ?? "No file uploaded" }}</span>
          </label>
        </div>
      </div>
      <button class="button is-success block" @click="saveFile(wasmFile)" title="Save file to OPFS">Save Wasm
        file</button>

      <div class="field">
        <div class="file has-name is-info">
          <label class="file-label">
            <input class="file-input" type="file" accept="application/json" @change="onJsonFileChanged($event)" />
            <span class="file-cta" title="Upload JSON config">
              <span class="file-label">Upload a file</span>
            </span>
            <span class="file-name">{{ jsonFile?.name ?? "No file uploaded" }}</span>
          </label>
        </div>
      </div>
      <button class="button is-success block" @click="saveFile(jsonFile)" title="Save file to OPFS">Save config
        file</button>
    </div>

    <div class="column">
      <label class="label has-text-grey-dark">Run</label>

      <div class="block buttons">
        <button class="button is-info" @click="updateJsonFileList"
          title="List all available JSON files in Dropdown">Update JSON
          Files</button>

        <div class="select is-info">
          <select :disabled="jsonFiles.length === 0" v-model="selectedJsonFile">
            <option v-for="fileName in jsonFiles" :key="fileName">{{ fileName }}</option>
          </select>
        </div>
      </div>

      <div class="buttons">
        <button class="button is-info block" @click="scheduler.registerLocalBorrowers"
          title="Register one local worker">Register Local Worker</button>
        <button class="button is-success block" :disabled="selectedJsonFile == null" @click="run"
          title="Run Wasm file with selected json config">Run</button>
        <button class="button is-success block" @click="runSingle" title="Run Wasm TSP file once">Run Once</button>
        <label class="checkbox">
          <input type="checkbox" v-model="trace">
          Trace Run
        </label>
        <button class="button is-success block" @click="downloadTraces" title="Download Traces">Download Traces</button>
      </div>

    </div>


    <!-- <label class="label has-text-grey-dark">Flags</label>
      <label class="checkbox">
        <input type="checkbox">
        Log Wasm Runs
      </label> -->

    <div v-if="showOOMtest">
      <label class="label has-text-grey-dark">Out of Memory Testing</label>
      <button class="button is-warning" @click="() => runloadtesting()"
        title="Run Load testing to trigger OOM error">Eat my Memory, plz</button>
    </div>


  </div>
</template>