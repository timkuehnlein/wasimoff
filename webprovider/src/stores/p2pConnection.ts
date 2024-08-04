import { Calls } from "@/fn/calls";
import type { WASMRun } from "@/fn/types";
import { digest } from "@/fn/utilities";
import { useWorkerPool } from "@/stores/workerpool";
import { P2PTransport, WebRTCTransport } from "@/transports";
import type { CompletedExecution } from "@/worker/wasmrunner";
import type { Stream } from "@libp2p/interface";
import * as MessagePack from "@msgpack/msgpack";
import * as lengthPrefixed from "it-length-prefixed";
import map from "it-map";
import { pipe } from "it-pipe";
import { defineStore, storeToRefs } from "pinia";
import { Uint8ArrayList } from "uint8arraylist";
import { computed, shallowRef, watch } from "vue";
import type { ConnectionStore, PoolInfo, ProviderInfo, UploadedFile } from ".";
import { useFilesystem } from "./filesystem";
import { useScheduler } from "./scheduler";
import { useTerminal } from "./terminal";

/** The connection store abstracts away the details of the underlying transport. */
export const useP2PConnection = defineStore<string, ConnectionStore>(
  "Connection",
  () => {
    const prefix = ["%c Connection ", "background: goldenrod; color: black;"];

    // use other stores for terminal output and filesystem access
    const terminal = useTerminal();
    const filesystem = useFilesystem();
    const scheduler = useScheduler();

    // use the worker pool needed to execute WASM
    let pool = useWorkerPool();

    // keep reference to the connection itself
    const transport = shallowRef<P2PTransport | null>(null);
    const connected = computed(() => transport.value !== null);

    // send control messages over the transport
    async function send<T>(type: string, message: T) {
      try {
        return messages.value.send({ type, message });
      } catch (err) {
        console.error(...prefix, "Failed to send message: Type:", type, err);
        throw err;
      }
    }

    // send rpc messages over the transport
    async function sendRPC<T>(method: string, seq: BigInt, body: T) {
      try {
        await rpc.value.send({ type: "request", method, seq, body });
      } catch (err) {
        console.error(...prefix, "Failed to send RPC request: Mehtod:", method);
        throw err;
      }
    }

    // access rpc and message channels when transport is connected
    const rpc = computed(() => {
      if (!connected.value) throw "transport is not connected";
      return transport.value!.rpc;
    });
    const messages = computed(() => {
      if (!connected.value) throw "transport is not connected";
      return transport.value!.messages;
    });
    const queue = computed(() => {
      if (!connected.value) throw "transport is not connected";
      return transport.value!.queue;
    });

    async function connect(url: string, certhash?: string) {
      // close any previous connections
      if (transport.value) transport.value.close();
      transport.value = null;

      // connect the new transport
      console.log(...prefix, "to WebRTC peer, through relay:", url);
      try {
        transport.value = await WebRTCTransport.connect(url);
      } catch (err) {
        console.error(...prefix, "Failed to connect to WebRTC peer:", err);
        throw err;
      }
      console.log(...prefix, "established", transport.value);
      terminal.info("P2P connection established.");

      // handle connection failures
      let toStr = (o: any) =>
        typeof o === "object" ? JSON.stringify(o) : String(o);
      transport.value.closed
        .then((info) => {
          transport.value = null;
          console.log(...prefix, `closed gracefully:`, info);
          terminal.info(`P2P connection closed gracefully: ` + toStr(info));
        })
        .catch((err) => {
          transport.value = null;
          console.error(...prefix, `closed unexpectedly:`, err);
          terminal.error(`P2P connection closed unexpectedly: ` + toStr(err));
        });

      // --------- MESSAGES ---------
      // send a "greeting" control message
      await send("hello", {
        sent: new Date().toISOString(),
      });

      await send("hello", {
        sent: new Date().toISOString(),
      });

      // send information about this provider
      providerInfo();
      poolInfo();
      watch(storeToRefs(pool).count, async () => poolInfo());

      // log received messages
      (async () => {
        try {
          for await (const message of messages.value.channel) {
            terminal.info("Message: " + JSON.stringify(message));
          }
        } catch (err) {
          console.error(...prefix, "Message Stream failed:", err);
          // terminal.error("Message Stream failed: " + String(err));
        }
      })();

      // --------- RPC REQUESTS ---------
      // handle rpc requests
      (async () => {
        try {
          for await (const { type, seq, body, method } of rpc.value.channel) {
            if (type === "response") {
              console.log(...prefix, "response message", seq, method, body);
              continue;
            }

            // `next` is resolved when we should continue to the next iteration
            await new Promise<void>(async (next) => {
              try {
                // try to handle the request with a method from the rpc map

                if (method in methods) {
                  const result = await methods[method](body, next);
                  console.log(
                    ...prefix,
                    "RPC call handler result",
                    seq,
                    method,
                    result
                  );
                  await rpc.value.send({
                    type: "response",
                    method,
                    seq,
                    body: result,
                  });
                } else throw "unknown method";
              } finally {
                // make sure to always resolve the Promise, if the handler didn't call it
                next();
              }
            });
          }
          // the iteration over the async generator somehow stopped
          console.log(...prefix, "RPC Stream has ended");
        } catch (err) {
          console.error(...prefix, "RPC Handler failed:", err);
          transport.value?.close();
        }
      })();

      // --------- QUEUE REQUESTS ---------

      const decoder = new MessagePack.Decoder({ useBigInt64: true });
      const encoder = new MessagePack.Encoder({ useBigInt64: true });

      // as callee, we need to handle requests
      if (queue.value.direction === "inbound") {
        // pipeNumberToString(queue.value);
        handleRequests(queue.value);
      }
      // as caller, we need to register the remote peer with the scheduler
      else
      {
        console.log("Registering remote consumer");
        scheduler.registerRemoteBorrower(queue.value);
      }

      /**
       * Consume a stream of WASMRun requests and return a stream of CompletedExecution results.
       * @param stream - Libp2p stream to read from and write back to; the stream is expected to contain length-prefixed MessagePack-encoded data
       */
      function handleRequests(stream: Stream): void {
        pipe(
          stream.source,
          (s) => lengthPrefixed.decode(s),
          (s) =>
            map<Uint8ArrayList, WASMRun>(
              s,
              (chunk) => decoder.decode(chunk.subarray()) as WASMRun
            ),
          (s) =>
            map(s, async (body) => {
              console.log(`Received: ${body.id}`, body);
              const result: CompletedExecution = await methods["run"](
                body,
                () => {}
              );
              result.context = "remote";
              console.log(...prefix, "Stream call handler result", result);
              return result;
            }),
          (s) => map(s, (chunk) => encoder.encode(chunk)),
          (s) => lengthPrefixed.encode(s),
          stream.sink
        );
      }
    }

    /** Send information about this Provider to the Broker. */
    async function providerInfo() {
      return send<ProviderInfo>("providerinfo", {
        platform: navigator.platform,
        useragent: navigator.userAgent,
      });
    }

    /** Send updates on worker pool capacity to the Broker. */
    async function poolInfo() {
      return send<PoolInfo>("poolinfo", {
        nmax: pool.nmax,
        pool: pool.count,
      });
    }

    async function run(body: WASMRun): Promise<CompletedExecution> {
      return Calls.run(body, () => {}, pool);
    }

    /** This hashtable contains all the known RPC function that may be called by the client broker.
     * * the key is the `method` name
     * * the RPC arguments are passed via `body`
     * * and `next` shall be called when the higher RPC request loop shall continue its next iteration.
     **/
    const methods: {
      [method: string]: (body: any, next: () => void) => Promise<any>;
    } = {
      /** Execute a stored WASI executable via the /run endpoint in Broker. */
      async run(body, next): Promise<CompletedExecution> {
        return Calls.run(body, next, pool);
      },

      /** Broker probes if we have a certain file. */
      async "fs:probe"(body: UploadedFile, next): Promise<boolean> {
        // expect a normal file sans the bytes
        const { filename, hash, length } = body;
        // find the file by filename
        let file = await filesystem
          .ls()
          .then((files) => files.find((f) => f.name === filename));
        if (file === undefined) return false;
        // check the filesize
        if (file.size !== length) return false;
        // calculate the sha256 digest, if file exists
        if (hash.byteLength !== 32)
          throw new Error("hash length must be 32 bytes");
        let sum = await digest(file);
        if (sum.byteLength !== 32)
          throw new Error("sha-256 digest has an unexpected length");
        // compare the hashes
        for (let i in sum) if (sum[i] !== hash[i]) return false;
        // file exists and hashes match
        return true;
      },

      /** Binaries "uploaded" from the Broker via RPC. */
      async "fs:upload"(body: UploadedFile, next): Promise<boolean> {
        // expect a filename and a binary
        const { filename, bytes, hash, epoch } = body;
        console.log(
          ...prefix,
          `UPLOAD '${filename}', ${bytes.byteLength} bytes`
        );
        await filesystem.store(bytes, filename);
        terminal.success(
          `Uploaded new file: '${filename}', ${bytes.byteLength} bytes`
        );
        return true;
      },

      /** Broker asks for a list of available files in storage. */
      async "fs:list"(body: null, next): Promise<Partial<UploadedFile>[]> {
        let has = await Promise.all(
          (
            await filesystem.ls()
          ).map(async (file) => ({
            filename: file.name,
            hash: await digest(file),
            length: file.size,
            epoch: BigInt(file.lastModified),
          }))
        );
        terminal.info("Sent list of available files to Broker.");
        return has;
      },

      /** Simple Ping-Pong message to say hello. */
      async ping(body: string, next): Promise<string> {
        if (body != "ping") throw "expected a 'ping'";
        return "pong";
      },
    }; /* methods */

    return { transport, connected, connect, run, queue };
  }
);
