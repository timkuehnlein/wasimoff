import { pairs } from "@/fn/utilities";
import * as MessagePack from "@msgpack/msgpack";

//? +--------------------------------------------------+
//? | Wrap a bidirectional stream in a net/rpc server. |
//? +--------------------------------------------------+


/** Decode MessagePack messages from a `ReadableStream` and yield the decoded RPC requests. */
export async function* NetRPCStreamDecoder(
  stream: ReadableStream<Uint8Array>
): NetRPCDecoder {
  // decode MessagePack encoded messages and yield [ header, body ] pairs for inner loop
  const messages = MessagePack.decodeMultiStream(stream, {
    useBigInt64: true,
    context: null,
  });

  try {
    for await (const { 0: header, 1: body } of pairs<NetRPCRequestHeader, any>(
      messages
    )) {
      // deconstruct the header and yield request information
      let { ServiceMethod: method, Seq: seq } = header;
      yield { method, seq, body };
    }
  } finally {
    // release the lock on .return()
    messages.return();
  }
}

/** Lock a `WritableStream` and return a function which encodes RPC responses on it. */
export function NetRPCStreamEncoder(
  stream: WritableStream<Uint8Array>
): NetRPCEncoder {
  // get a lock on the writer and create a persistent MessagePack encoder
  const writer = stream.getWriter();
  const msgpack = new MessagePack.Encoder({
    useBigInt64: true,
    initialBufferSize: 65536,
  });

  return {
    // anonymous { next, close }

    // encode a chunk as response
    async next(r) {
      // encode the response halves into a single buffer
      // TODO: optimize with less buffer copy operations, e.g. use .encodeSharedRef() or Uint8ArrayList
      let header = msgpack.encode({
        ServiceMethod: r.method,
        Seq: r.seq,
        Error: r.error,
      } as NetRPCResponseHeader);
      let body = msgpack.encode(r.body as any);
      let buf = new Uint8Array(header.byteLength + body.byteLength);
      buf.set(header, 0);
      buf.set(body, header.byteLength);
      // wait for possible backpressure on stream and then write
      await writer.ready;
      return writer.write(buf);
    },

    // close the writer
    async close() {
      return writer.close().then(() => writer.releaseLock());
    },
  };
}

/** Wrap a bidirectional WebTransport stream and return an asynchronous generator of RPC requests to handle. */
export async function* NetRPCStreamServer(stream: WebTransportBidirectionalStream): RPCServer {
  // pretty logging prefixes
  const prefixRx = [
    "%c RPC %c « Call %c %s ",
    "background: #333; color: white;",
    "background: skyblue;",
    "background: #ccc;",
  ];
  const prefixTx = [
    "%c RPC %c Done » %c %s ",
    "background: #333; color: white;",
    "background: greenyellow;",
    "background: #ccc;",
  ];
  const prefixErr = [
    "%c RPC %c Error ",
    "background: #333; color: white;",
    "background: firebrick; color: white;",
  ];
  const prefixWarn = [
    "%c RPC %c Warning ",
    "background: #333; color: white;",
    "background: goldenrod;",
  ];

  // create the net/rpc messsagepack codec on the stream
  const decoder = NetRPCStreamDecoder(stream.readable);
  const encoder = NetRPCStreamEncoder(stream.writable);

  try {
    // generator loop

    // for each request .. yield a function that must be called with an async handler
    for await (const { method, seq, body } of decoder) {
      console.debug(...prefixRx, method, seq, body);
      yield async (handler) => {
        try {
          // happy path: return result to client
          let result = await handler(method, body);
          console.debug(...prefixTx, method, seq, result);
          await encoder.next({ method, seq, body: result });
        } catch (error) {
          // catch errors and report back to client
          console.warn(...prefixErr, method, seq, error);
          await encoder.next({
            method,
            seq,
            body: undefined,
            error: String(error),
          });
        }
      };
    }
    console.warn(...prefixWarn, "NetRPCStreamDecoder has ended!");
  } finally {
    // handle .return() by closing streams

    // close both directional streams in parallel
    await Promise.allSettled([
      // release lock on the decoder, then close the readable
      await decoder.return().then(() => stream.readable.cancel()),

      // close and release the writer in the encoder
      //! this will cut off any in-flight requests, unfortunately
      encoder.close(),
    ]);
  }
}

//? +----------------------------------------------------------+
//? | various types that must be implemented by the transports |
//? +----------------------------------------------------------+

/** The header of a Go `net/rpc` RPC request. */
export type NetRPCRequestHeader = { ServiceMethod: string; Seq: BigInt };

/** The header of a Go `net/rpc` RPC response. */
export type NetRPCResponseHeader = NetRPCRequestHeader & { Error?: string };

/** An RPC decoder is an async generator of RPC request information. */
export type NetRPCDecoder = AsyncGenerator<RPCRequestInfo, void, undefined>;

/** An RPC encoder takes responses to write and can be closed. */
export type NetRPCEncoder = { next: RPCResponder; close: () => Promise<void> };

/** The fields of an RPC request used internally. */
export type RPCRequestInfo = {
  method: string;
  seq: BigInt;
  body: any;
  error?: string;
};

/** A function that must be called with an async function to handle the RPC request. */
export type RPCRequest = (
  handler: (method: string, body: any) => Promise<any>
) => Promise<void>;

/** Signature of a function that encodes and sends net/rpc-compatible responses to the requester. */
export type RPCResponder = (response: RPCRequestInfo) => Promise<void>;

/** An async generator of `RPCRequest`s to be handled. */
export type RPCServer = AsyncGenerator<RPCRequest, void, undefined>;