import * as MessagePack from "@msgpack/msgpack";
import type { Stream } from "@libp2p/interface";
import { toReadableStream, toWritableStream } from "@/fn/utilities";

export interface ClosableTransport {
  close(): Promise<void>;
}

/** An abstract class, which implements a connection to the Broker with various functions. */
export abstract class BrokerTransport implements ClosableTransport {
  // overall status of this transport
  abstract closed: Promise<any>;
  abstract close: () => Promise<void>;

  // a stream of rpc requests that should be handled
  abstract rpc: RPCServer;

  // a bidirectional stream for control messages
  abstract messages: AsyncChannel<unknown>;
}

// re-export the implemented transports
export { WebTransportBroker } from "./webtransport";

/** An abstract class, which implements a P2P connection with various functions. */
export abstract class P2PTransport implements ClosableTransport {
  // overall status of this transport
  abstract closed: Promise<any>;
  abstract close: () => Promise<void>;

  // a stream of rpc requests that should be handled
  abstract rpc?: RPCServer;

  // a bidirectional stream for control messages
  abstract messages: AsyncChannel<unknown>;

  abstract stream?: Stream;
}

// re-export the implemented transports
export { WebRTCTransport } from "./webRTCTransport";

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

//? +-------------------------------------------------------------------+
//? | a generic wrapper which makes bidirectional streams easier to use |
//? +-------------------------------------------------------------------+

// type for an asymmetric channel
export interface AsyncChannel<Value> {
  channel: AsyncGenerator<Value, void, undefined>;
  send: (value: Value) => Promise<void>;
  close: () => Promise<void>;
}

abstract class MessagePackChannel<Message> implements AsyncChannel<Message> {
  /** `channel` asynchronously receives incoming messages */
  public channel: AsyncGenerator<Message, void, undefined>;

  /** `writer` is the locked writable stream for the encoder */
  private writer: WritableStreamDefaultWriter<Uint8Array>;

  // reusing can lead to up to 20% performance improvement
  private decoder = new MessagePack.Decoder({ useBigInt64: true });
  private encoder = new MessagePack.Encoder({ useBigInt64: true });

  /** Locks a bidirectional stream to use it as a channel for any MessagePack messages. */
  constructor(readable: ReadableStream, writable: WritableStream) {
    // the receive channel is simply the messagepack decoder
    //! it is important that the generator releases the lock on the stream on return()
    this.channel = this.decoder.decodeStream(readable) as typeof this.channel;

    // the encoder needs to lock the writer and keep it around so it can be released
    this.writer = writable.getWriter();
  }

  /** `send` can be used to send messages asynchronously */
  async send(message: Message) {
    await this.writer.ready;
    let chunk = this.encoder.encode(message);
    await this.writer.write(chunk);
  }

  /** `close` tries to gracefully close the channel */
  async close() {
    // close both directional streams in parallel
    await Promise.allSettled([
      // release lock on the generator, then close the readable
      this.closeRead().then(() =>
        console.error("MessagePackChannel `channel` closed")
      ),

      // we're holding the lock on writer, so we can close it directly
      this.writer
        .close()
        .then(() => this.writer.releaseLock())
        .then(() => console.error("MessagePackChannel `writer` closed")),
    ]);
  }

  abstract closeRead(): Promise<void>;
}

export class WebTransportMessageChannel<
  Message = any
> extends MessagePackChannel<Message> {
  constructor(private stream: WebTransportBidirectionalStream) {
    super(stream.readable, stream.writable);
  }

  closeRead = () =>
    this.channel.throw("").then(() => this.stream.readable.cancel());
}

export class Libp2pStreamChannel<
  Message = any
> extends MessagePackChannel<Message> {
  constructor(private stream: Stream) {
    super(toReadableStream(stream), toWritableStream(stream));
  }

  closeRead = () => this.stream.closeRead();
}
