import { toReadableStream, toWritableStream } from "@/fn/utilities";
import type { Stream } from "@libp2p/interface";
import * as MessagePack from "@msgpack/msgpack";
import type { RPCServer } from "./netRPCServer";

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

  // a bidirectional stream of rpc requests that should be handled
  abstract rpc: AsyncChannel<P2PRPCMessage>;

  // a bidirectional stream for control messages
  abstract messages: AsyncChannel<unknown>;

  // a bidirectional stream of WASMRun objects to be handled and CompletedExecution objects as results
  abstract queue: Stream;
}

// re-export the implemented transports
export { WebRTCTransport } from "./webRTCTransport";

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

export type P2PRPCMessage = {
  type: "request" | "response";
  method: string;
  seq: BigInt;
  body: any;
};
