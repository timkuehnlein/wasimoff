/// <reference types="vite/client" />

declare module "async-iterator-to-pull-stream";
declare module "pull-stream-to-async-iterator";
declare module "pull-limit";

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
