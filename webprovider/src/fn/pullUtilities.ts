import * as MessagePack from "@msgpack/msgpack";
import toPull from "async-iterator-to-pull-stream";
import * as lengthPrefixed from "it-length-prefixed";
import map from "it-map";
import { pipe } from "it-pipe";
import type { Duplex, Sink, Source } from "it-stream-types";
import { type Borrower, type SubStream } from "pull-lend-stream";
import limit from "pull-limit";
import pull from "pull-stream";
import type { Uint8ArrayList } from "uint8arraylist";

/**
 * typed version of toPull.sink() of https://github.com/alanshaw/async-iterator-to-pull-stream/tree/master
 * @param sink it sink
 * @returns pull sink
 */
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

/**
 * Creates a borrower function that maps data elements on a substream from In to Out, outsourced to a stream connected remote worker.
 * @param consumer stream to remote worker, expected to accept and return length-prefixed MessagePack-encoded values of types In/Out respectively
 * @param batchSize number of messages allowed to be sent to remote worker at once
 * @returns borrower function that can be used to handle a substream
 */
export function borrowerForRemote<In, Out>(
  consumer: Duplex<
    AsyncGenerator<Uint8ArrayList>,
    Source<Uint8ArrayList | Uint8Array>,
    Promise<void>
  >,
  batchSize: number = 1,
  latency: number = 0
): Borrower<In, Out> {
  const encoder = new MessagePack.Encoder({ useBigInt64: true });
  const decoder = new MessagePack.Decoder({ useBigInt64: true });

  return function (err: Error | null, stream: SubStream<In, Out>): void {
    if (err) return console.log(err.message);

    const encodeInTypeToStream: Sink<Source<In>> = (sr: Source<In>) =>
      pipe(
        sr,
        (s) => map(s, async (n) => (await new Promise((resolve) => setTimeout(() => resolve(n), latency)) as In)),
        (s) => map(s, (n) => encoder.encode(n)),
        (s) => lengthPrefixed.encode(s),
        consumer.sink
      );

    const decodeStreamToOutType: Source<Out> = pipe(
      consumer.source,
      (s) => lengthPrefixed.decode(s),
      (s) => map(s, (array) => decoder.decode(array.subarray()) as Out),
      (s) => map(s, async (n) => (await new Promise((resolve) => setTimeout(() => resolve(n), latency)) as Out))
    );

    const encodedRemoteStreamAsPull: pull.Duplex<Out, In> = {
      sink: toPullSink(encodeInTypeToStream),
      source: toPull.source(decodeStreamToOutType),
    };

    pull(
      stream.source,
      // limit batch size for remote, otherwise the stream will drain all messages
      limit(encodedRemoteStreamAsPull, batchSize),
      stream.sink
    );
  };
}

type MyMapper<In, Out> = (data: In, cb: pull.SourceCallback<Out>) => any;

/**
 * Create a borrower function that maps data elements on a substream from In to Out.
 * @param mapper map function that takes a data element and a callback. The callback should be called with the mapped data.
 * @returns a borrower, which is a function that handles a substream
 */
export function borrower<In, Out>(
  mapper: MyMapper<In, Out>,
  batchSize: number = 1
): Borrower<In, Out> {
  return function (err: Error | null, stream: SubStream<In, Out>): void {
    if (err) return console.log(err.message);
    pull(
      stream,
      limit(pull.asyncMap(mapper), batchSize),
      pull.through(
        (data) => data,
        (onEnd) => {
          if (onEnd && onEnd !== true) console.log(onEnd);
          // necessary?
          // stream.close(onEnd);
        }
      ),
      stream
    );
  };
}

// /**
//  * Transform a pull stream through function to a transform function for iterables.
//  * @param pullThrough pull stream through function, a connected source and sink, pendant to a transform function of iterables
//  * @returns transform function for iterables
//  */
// export function toIteratorTransform<In, Out>(
//   pullThrough: Through<In, Out>
// ): Transform<Source<In>, Out> {
//   return (source: Source<In>) => toIterator(pullThrough(toPull(source)));
// }
