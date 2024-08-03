// modified from https://github.com/libp2p/js-libp2p/blob/337f0251f22209247b36e9c646560acc0ecc1ae2/examples/chat/src/stream.js

import { pipe } from "it-pipe";
import map from "it-map";
import { abortableSource, abortableDuplex } from "abortable-iterator";
import * as lengthPrefixed from "it-length-prefixed";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import type { Stream } from "@libp2p/interface";

export async function iostream(stream: Stream) {
  const controller = new AbortController();
  const stdin = abortableSource(process.stdin, controller.signal);
  const duplex = abortableDuplex(stream, controller.signal);
  try {
    await pipe(
      stdin,
      (pipe) => map(pipe, (line) => uint8ArrayFromString(line)),
      (pipe) => lengthPrefixed.encode(pipe),
      duplex,
      (pipe) => lengthPrefixed.decode(pipe),
      (pipe) => map(pipe, (buf) => uint8ArrayToString(buf.slice())),
      (pipe) =>
        map(pipe, (line) => {
          console.log(">>", line.toString().replace("\n", ""));
        })
    );
  } catch (err) {
    console.log("whoops, stream failed:", err);
  } finally {
    controller.abort();
  }
}

export async function loopToStream(stream: Stream) {
  async function* run() {
    for (let i = 0; i < 20; i++) {
      console.log("sending", i);
      yield uint8ArrayFromString(`Iteration ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // without encoding or length prefix the stream closes prematurely
  await pipe(run(), lengthPrefixed.encode, stream.sink);
}

export function helloWorldToStream(stream: Stream) {
  return pipe(
    [uint8ArrayFromString("Hello World")],
    (source) => lengthPrefixed.encode(source),
    stream.sink
  );
}

export function stdinToStream(stream: Stream) {
  // Read utf-8 from stdin
  process.stdin.setEncoding("utf8");
  return pipe(
    // Read from stdin (the source)
    process.stdin,
    // Turn strings into buffers
    async function* (input) {
      for await (const string of input) {
        yield uint8ArrayFromString(string);
      }
    },
    // (source) => map(source, (string) => uint8ArrayFromString(string)),
    // Encode with length prefix (so receiving side knows how much data is coming)
    (source) => lengthPrefixed.encode(source),
    // Write to the stream (the sink)
    stream.sink
  );
}

export function streamToConsole(stream: Stream) {
  return pipe(
    // Read from the stream (the source)
    stream.source,
    // Decode length-prefixed data
    (source) => lengthPrefixed.decode(source),
    // Turn buffers into strings
    async function* (input) {
      for await (const chunk of input) {
        yield uint8ArrayToString(chunk.slice());
      }
    },
    // (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())),
    // Sink function
    async function (source) {
      // For each chunk of data
      for await (const msg of source) {
        // Output the data as a utf8 string
        console.log(">>", msg.toString().replace("\n", ""));
      }
    }
  );
}
