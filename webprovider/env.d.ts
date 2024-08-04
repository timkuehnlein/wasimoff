/// <reference types="vite/client" />

// ReadableStreams *do* have this method ...
// https://github.com/microsoft/TypeScript/issues/29867
interface ReadableStream<R = any> {
  [Symbol.asyncIterator](): AsyncIterator<R>;
}

// fix WebTransport types

/** Stream of incoming bidirectional streams.
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport/incomingBidirectionalStreams) */
type BidirectionalStreams = ReadableStream<WebTransportBidirectionalStream>;

/** Stream of incoming unidirectional streams.
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport/incomingUnidirectionalStreams) */
type UnidirectionalStreams = ReadableStream<WebTransportReceiveStream>;

/** A bidirectional stream has a `readable` and a `writable` `Uint8Array` stream.
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/WebTransportBidirectionalStream) */
type WebTransportBidirectionalStream = {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
};

/** An unidirectional stream is simply a readable of `Uint8Array`.
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/WebTransportReceiveStream) */
type WebTransportReceiveStream = ReadableStream<Uint8Array>;

// adapted from https://www.npmjs.com/package/pull-lend-stream#signature
declare module "pull-lend-stream" {
  import type { Duplex, Sink, Source } from "pull-stream";

  function lendStream<In, Out>(): Lender<In, Out>;

  type Lender<In, Out> = {
    sink: Sink<Out>;
    lendStream: (borrower: Borrower<In, Out>) => void;
    source: Source<In>;
  };

  export type Borrower<In, Out> = (
    err: Error | null,
    subStream: SubStream<In, Out>
  ) => void;

  export type SubStream<In, Out> = Duplex<In, Out> & {
    close: (err?: Error) => void;
  };

  export default lendStream;
}

declare module "pull-stream-to-async-iterator";
declare module "async-iterator-to-pull-stream";
declare module "pull-limit";
