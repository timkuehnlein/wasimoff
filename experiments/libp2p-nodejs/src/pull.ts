import pull from "pull-stream";
import type { Source, Sink } from "it-stream-types";
import * as MessagePack from "@msgpack/msgpack";
import { Uint8ArrayList } from "uint8arraylist";
import { Stream } from "@libp2p/interface";
import toPull from "async-iterator-to-pull-stream";

export async function pullStream(stream: Stream) {
  const encoder = new MessagePack.Encoder({ useBigInt64: true });
  const decoder = new MessagePack.Decoder({ useBigInt64: true });

  console.log(stream.status);

  if (stream.direction === "inbound") {
    for await (const chunk of stream.source) {
      const decoded = decoder.decode(chunk.subarray());
      console.log("Q Message: " + decoded);
      await new Promise((r) => setTimeout(r, 5000));
    }
  } else {
    pull(
      pull.count(10),
      pull.through((data) => console.log("Pull Stream generated data: ", data)),
      pull.map((data) => {
        const e = encoder.encode(data);
        console.log("Encoded: ", e);
        return e;
      }),
      toPullSink(stream.sink)
    );
  }
}

export async function basicPullExample() {
  const source = pull(
    pull.count(10),
    pull.through((data) => console.log("Pull Stream generated data: ", data))
  );

  var ended = false;
  while (!ended) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    source(null, (end, data) => {
      if (end) {
        ended = true;
        console.log("Pull Stream ended");
      } else {
        console.log("Pull Stream data: ", data);
      }
    });
  }
}

export function basicPullToIterableExample() {
  const encoder = new MessagePack.Encoder({ useBigInt64: true });

  const sink: Sink<Source<Uint8ArrayList>, Promise<void>> = async (source) => {
    for await (const chunk of source) {
      console.log("Q Message: " + chunk.subarray().toString());
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  pull(
    pull.count(10),
    pull.through((data) => console.log("Pull Stream generated data: ", data)),
    pull.map((data) => encoder.encode(data)),
    toPullSink(sink)
    // toPull.sink(sink)
  );
}

// typed version of toPull.sink() of https://github.com/alanshaw/async-iterator-to-pull-stream/tree/master
export function toPullSink<T>(sink: Sink<Source<T>>): pull.Sink<T> {
  return (read) => {
    const aIterator: AsyncIterable<T> = {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise((resolve, reject) => {
              read(null, (end, value) => {
                if (end === true) return resolve({ done: true, value });
                if (end) return reject(end);
                resolve({ done: false, value: value as T });
              });
            }),

          return: () =>
            new Promise((resolve, reject) => {
              read(true, (end, value) => {
                if (end && end !== true) return reject(end);
                resolve({ done: true, value });
              });
            }),

          throw: (err) =>
            new Promise((resolve, reject) => {
              read(err, (end, value) => {
                if (end && end !== true) return reject(end);
                resolve({ done: true, value });
              });
            }),
        };
      },
    };

    const source: AsyncIterable<T> = aIterator;

    sink(source);
  };
}
