import { stringify } from "csv-stringify";

/** Collected events with timestamps. */
type Event<T> = { time: T; label: string };

/** An exported Trace with start time and events in microsecond unix epochs. */
// export type ExportedTrace = { start: BigInt, events: Event<BigInt>[] };
export type ExportedTrace = Event<bigint>[];

type TraceEvent = {
  UnixMicro: bigint; // the timestamp in unix epoch microseconds
  Delta: number; // delta from beginning of trace in milliseconds
  Step: number; // step from previous event in milliseconds
  Label: string; // event label
  Context?: "local" | "remote"; // event context
};

/** A simple class to log timestamps at certain points of the execution. */
export class Trace {
  constructor(label?: string) {
    if (label !== undefined) this.now(label);
  }

  // time origin and starting time offset in milliseconds
  private readonly origin = performance.timeOrigin;
  private readonly t0: number = performance.now();

  // calculate the unix epoch
  private epoch(t: number) {
    return this.origin + t;
  }

  // calculate unix epochs in microseconds
  private unixmicro(t: number) {
    return BigInt(this.epoch(t).toPrecision(16).replace(".", ""));
  }

  // format an ISO string with microseconds
  private isomicro(t: number) {
    let epoch = this.epoch(t);
    let iso = new Date(epoch).toISOString();
    console.error("EVENT", epoch, iso, (epoch % 1).toPrecision(3));
    return iso.replace("Z", (epoch % 1).toPrecision(3).substring(2, 5) + "Z");
  }

  // collected events with timestamps
  private events: Event<number>[] = [];

  /** Add a new event with a string label and optional data. */
  public async now(label: string) {
    this.events.push({ time: performance.now(), label });
  }

  /** Export the collected events and calculate deltas. */
  public async export(existingTrace?: ExportedTrace): Promise<ExportedTrace> {
    const newEvents = this.events.map((ev) => ({
      label: ev.label,
      time: this.unixmicro(ev.time),
    }));
    return [...(existingTrace ?? []), ...newEvents];
  }
}

export function exportTracesToFile(
  traces: { trace: ExportedTrace; context?: "remote" | "local" }[],
  filename: string
) {
  const processedTraces = traces.map((t) => processTrace(t.trace, t.context));
  console.log("Processed traces", processedTraces);

  // Check if all traces have the same events
  for (const trace of processedTraces) {
    for (let i = 0; i < trace.length; i++) {
      if (trace[i].Label !== processedTraces[0][i].Label) {
        console.error(new Error("traces didn't log the same events"));
      }
    }
  }

  // Calculate averages
  const averages: TraceEvent[] = new Array(processedTraces[0].length + 1); // +1 for total
  for (
    let fieldIndex = 0;
    fieldIndex < processedTraces[0].length;
    fieldIndex++
  ) {
    const event = processedTraces[0][fieldIndex];
    averages[fieldIndex] = { ...event, Step: 0 }; // Initialize with the same label and other properties

    let stepSum = 0;
    for (let processedTrace of processedTraces) {
      stepSum += processedTrace[fieldIndex].Step;
    }
    averages[fieldIndex].Step = stepSum / processedTraces.length / 1000;
  }

  averages[averages.length - 1] = {
    Delta: 0,
    UnixMicro: 0n,
    Label: "total",
    Step: averages.reduce((acc, val) => acc + val.Step, 0),
  };

  const records = averages.map((event) => ({
    Step: event.Step.toFixed(3),
    Label: event.Label,
  }));

  const csvStringifier = stringify({
    header: true,
    columns: [
      { key: "Step", header: "step_ms" },
      { key: "Label", header: "label" },
    ],
    delimiter: ";",
  });

  let csvData = "";
  csvStringifier.on("data", (chunk) => {
    csvData += chunk;
  });

  csvStringifier.on("end", () => {
    console.log("CSV data was generated successfully");
    const blob = new Blob([csvData], { type: "text/csv" });
    // You can now use the blob as needed
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();

    // post the data as csv text file to the server in the post body
    try {
      fetch(window.location.origin + "/api/broker/v1/download", {
        method: "POST",
        body: csvData,
        headers: {
          "Content-Type": "text/csv",
        },
      });
    } catch (error) {
      console.error("Error:", error);
    }
  });

  console.log(records);
  records.forEach((r) => csvStringifier.write(r));
  // csvStringifier.write(records);
  csvStringifier.end();

  // csvStringifier.write(records);
  // csvStringifier.pipe(fs.createWriteStream('output.csv')).on('finish', () => {
  //   console.log('CSV file was written successfully');
  // });

  // const blob = new Blob([csvStringifier], { type: 'text/csv' });
  // const url = URL.createObjectURL(blob);
  // const a = document.createElement('a');
  // a.href = url;
  // a.download = 'output.csv';
  // a.click();

  // const url = URL.createObjectURL(blob);
  // const a = document.createElement("a");
  // a.href = url;
  // a.download = filename;
  // a.click();
}

function processTrace(
  trace: ExportedTrace,
  context?: "remote" | "local"
): TraceEvent[] {
  const result: TraceEvent[] = new Array(trace.length);
  const t0 = trace[0].time;

  for (let i = 0; i < trace.length; i++) {
    const event = trace[i];
    const r: TraceEvent = {
      UnixMicro: event.time,
      Label: event.label,
      Delta: Number((event.time - t0) / 1n), // todo milliseconds 1000? (is in microseconds); not being used
      Step: i === 0 ? 0.0 : Number((event.time - trace[i - 1].time) / 1n), // todo milliseconds 1000? (is in microseconds)
      Context: context,
    };
    result[i] = r;
  }

  return result;
}
