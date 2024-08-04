import * as lengthPrefixed from "it-length-prefixed";
import type { Source, Sink, Transform } from "it-stream-types";
import type { Uint8ArrayList } from "uint8arraylist";
import { pipe } from "it-pipe";
import pull, { Through } from "pull-stream";
import lendStream, { type SubStream, type Borrower } from "pull-lend-stream";
import toIterator from "pull-stream-to-async-iterator";
import toPull from "async-iterator-to-pull-stream";
import * as MessagePack from "@msgpack/msgpack";
import { toPullSink } from "./pull.js";
import { Stream } from "@libp2p/interface";
import map from "it-map";
import { range } from "iter-tools";
import limit from "pull-limit";

const encoder = new MessagePack.Encoder({ useBigInt64: true });
const decoder = new MessagePack.Decoder({ useBigInt64: true });

/**
 * Minimal example of a pull stream lender
 */
export function exampleLender(): void {
  var lender = lendStream<number, number>();

  // Prints -0,11,12,-3,14,15,-6,17,18,-9,20
  pull(
    pull.count(10),
    pull.through((data) => console.log("Pull Stream generated data: ", data)),
    lender,
    pull.collect(function (err, results) {
      if (err) throw err;
      console.log(results);
    })
  );

  lender.lendStream(borrower(minus));
  lender.lendStream(borrower(addTen));
}

function minus(x: number, cb: pull.SourceCallback<number>): void {
  setTimeout(function () {
    console.log("-", x);

    if (x > 4) return cb({ name: "MinusError", message: "Number too big" });
    cb(null, -x);
  }, 2000);
}

// Twice faster
function addTen(x: number, cb: pull.SourceCallback<number>): void {
  setTimeout(function () {
    console.log("10 +", x);
    cb(null, 10 + x);
  }, 1000);
}

type MyMapper<In, Out> = (data: In, cb: pull.SourceCallback<Out>) => any;

/**
 * Create a borrower function that maps data elements on a substream from In to Out.
 * @param mapper map function that takes a data element and a callback. The callback should be called with the mapped data.
 * @returns a borrower, which is a function that handles a substream
 */
function borrower<In, Out>(mapper: MyMapper<In, Out>): Borrower<In, Out> {
  return function (err: Error | null, stream: SubStream<In, Out>): void {
    if (err) return console.log(err.message);
    pull(
      stream,
      pull.asyncMap(mapper),
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

/**
 * Consume a stream of numbers and return a stream of strings.
 * Helper function to demonstrate a remote worker.
 * @param stream - Libp2p stream to read from and write back to; the stream is expected to contain length-prefixed MessagePack-encoded numbers
 */
export function pipeNumberToString(stream: Stream): void {
  pipe(
    stream.source,
    (s) => lengthPrefixed.decode(s),
    (s) =>
      map<Uint8ArrayList, number>(
        s,
        (chunk) => decoder.decode(chunk.subarray()) as number
      ),
    (s) =>
      map(s, async (chunk) => {
        console.log(`Received: ${chunk}`, chunk);
        await new Promise((r) => setTimeout(r, 1000));
        return `Remote: ${chunk}`;
      }),
    (s) => map(s, (chunk: string) => encoder.encode(chunk)),
    (s) => lengthPrefixed.encode(s),
    stream.sink
  );
}

/**
 * Creates a borrower function that maps data elements on a substream from In to Out, outsourced to a stream connected remote worker.
 * @param libP2PStream stream to remote worker, expected to accept and return length-prefixed MessagePack-encoded values of types In/Out respectively
 * @param batchSize number of messages allowed to be sent to remote worker at once
 * @returns borrower function that can be used to handle a substream
 */
function borrowerForRemote<In, Out>(
  libP2PStream: Stream,
  batchSize: number = 1
): Borrower<In, Out> {
  return function (err: Error | null, stream: SubStream<In, Out>): void {
    if (err) return console.log(err.message);

    const encodeInTypeToStream: Sink<Source<In>> = (sr: Source<In>) =>
      pipe(
        sr,
        (s) => map(s, (n) => MessagePack.encode(n)),
        (s) => lengthPrefixed.encode(s),
        libP2PStream.sink
      );

    const decodeStreamToOutType: Source<Out> = pipe(
      libP2PStream.source,
      (s) => lengthPrefixed.decode(s),
      (s) => map(s, (array) => MessagePack.decode(array.subarray()) as Out)
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

/**
 * Transform a pull stream through function to a transform function for iterables.
 * @param pullThrough pull stream through function, a connected source and sink, pendant to a transform function of iterables
 * @returns transform function for iterables
 */
function toIteratorTransform<In, Out>(
  pullThrough: Through<In, Out>
): Transform<Source<In>, Out> {
  return (source: Source<In>) => toIterator(pullThrough(toPull(source)));
}

/**
 * Example of a pull stream lender that outsources work to a remote worker.
 * @param libP2PStream the stream to outsource work through to remote
 */
export async function exampleInteropLender(
  libP2PStream: Stream
): Promise<void> {
  var lender = lendStream<number, string>();

  // example sink
  const stringSink: Sink<Source<string>, Promise<void>> = async (source) => {
    for await (const chunk of source) {
      console.log("Q Message: " + chunk);
    }
  };

  // pull (lender works with pull streams)
  const pullPipe: Through<number, string> = (
    source: pull.PossibleSource<number>
  ) =>
    pull(
      source,
      // optional transform
      lender
      // optional transform
    );

  // iterable, hightest level
  pipe(
    range(100),
    (s) =>
      map<number, number>(s, (x) => {
        console.log("sending", x);
        return x;
      }),
    toIteratorTransform(pullPipe),
    stringSink
  );

  // borrow a substream to be handled by a remote worker
  lender.lendStream(borrowerForRemote<number, string>(libP2PStream));
  // borrow a substream to be handled locally
  lender.lendStream(
    borrower(async (x, cb) => {
      await new Promise((r) => setTimeout(r, 1000));
      cb(null, `Local ${x}`);
    })
  );
}
