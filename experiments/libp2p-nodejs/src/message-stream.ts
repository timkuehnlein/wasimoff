import * as MessagePack from "@msgpack/msgpack";
import { pipe } from "it-pipe";
import type { Stream } from "@libp2p/interface";
import { Uint8ArrayList } from "uint8arraylist";
import { Source } from "it-stream-types";
import { lpStream } from "it-length-prefixed-stream";
import * as lp from "it-length-prefixed";

// type for an asymmetric channel
export interface AsyncChannel<Value> {
  channel: AsyncGenerator<Value, void, undefined>;
  send: (value: Value) => Promise<void>;
  close: () => Promise<void>;
}

export class Libp2pStreamChannel<Message = any>
  implements AsyncChannel<Message>
{
  /** `channel` asynchronously receives incoming messages */
  public channel: AsyncGenerator<Message, void, undefined>;

  /** `writer` is the locked writable stream for the encoder */
  private writer: WritableStreamDefaultWriter<Uint8Array>;

  private encoder = new MessagePack.Encoder({ useBigInt64: true });
  private decoder = new MessagePack.Decoder({ useBigInt64: true });

  /** Locks a bidirectional stream to use it as a channel for any MessagePack messages. */
  constructor(private stream: Stream) {
    // const readableLengthPrefixed = pipe(stream, (source) => lp.decode(source));
    // , s => this.encoder.encode(s));
    // const readable = toReadableStream(readableLengthPrefixed);

    const readable = toReadableStreamViaLp(stream);
    this.channel = MessagePack.decodeMultiStream(
      readable
    ) as typeof this.channel;

    const writable = toWritableStreamViaLp(stream);
    this.writer = writable.getWriter();
  }

  /** `send` can be used to send messages asynchronously */
  async send(message: Message) {
    await this.writer.ready;
    let chunk = this.encoder.encode(message)
    await this.writer.write(chunk);
    await this.writer.ready;
  }

  /** `close` tries to gracefully close the channel */
  async close() {
    this.stream.close();
  }
}

function toReadableStreamViaLp(stream: Stream): ReadableStream<Uint8Array> {
  const source = pipe(stream.source, (source) => lp.decode(source));
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for await (const chunk of source) {
        if (chunk instanceof Uint8ArrayList) {
          for (const buf of chunk) {
            controller.enqueue(buf);
          }
        } else {
          controller.enqueue(chunk);
        }
      }
      controller.close();
    },
    cancel() {
      // Handle cancellation if needed
    },
  });
}

function toReadableStream(
  source: Source<Uint8ArrayList | Uint8Array>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for await (const chunk of source) {
        if (chunk instanceof Uint8ArrayList) {
          for (const buf of chunk) {
            controller.enqueue(buf);
          }
        } else {
          controller.enqueue(chunk);
        }
      }
      controller.close();
    },
    cancel() {
      // Handle cancellation if needed
    },
  });
}

function toWritableStreamViaLp(stream: Stream): WritableStream<Uint8Array> {
  const lp = lpStream(stream);
  return new WritableStream<Uint8Array>({
    async write(chunk, controller) {
      console.log("writing chunk", chunk, typeof chunk);
      try {
        await lp.write(chunk);
      } catch (err) {
        controller.error(err);
      }
    },
    close() {
      stream.closeWrite();
      // Handle stream close if needed
    },
    abort() {
      // Handle stream abort if needed
    },
  });
}

function toWritableStream(stream: Stream): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk, controller) {
      console.log("chunk", chunk, typeof chunk);
      try {
        await stream.sink(
          (async function* () {
            yield chunk;
          })()
        );
      } catch (err) {
        controller.error(err);
      }
    },
    close() {
      stream.closeWrite();
      // Handle stream close if needed
    },
    abort() {
      // Handle stream abort if needed
    },
  });
}
