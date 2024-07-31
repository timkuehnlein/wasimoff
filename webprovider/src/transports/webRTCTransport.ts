import { next, pairs } from "@/fn/utilities";
import type {
  AsyncChannel,
  NetRPCDecoder,
  NetRPCEncoder,
  NetRPCRequestHeader,
  NetRPCResponseHeader,
  P2PTransport,
  RPCServer,
} from "@/transports";
import { Libp2pStreamChannel } from "@/transports";
import { gossipsub as pubsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from "@libp2p/bootstrap";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import type { Stream } from "@libp2p/interface";
import { pubsubPeerDiscovery } from "@libp2p/pubsub-peer-discovery";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import * as MessagePack from "@msgpack/msgpack";
import { createLibp2p, type Libp2p, type Libp2pOptions } from "libp2p";

//? +--------------------------------------------------------------+
//? | Implement a P2P transport over a WebRTC connection.          |
//? +--------------------------------------------------------------+

const WASMOFF_MSG_PROTOCOL = "/wasmoff/msg/0.0.1";

/** `WebRTCTransport` implements a WebRTC connection to peers, on
 * which there is an asymmetric channel for control messages and an async generator
 * of received RPC requests. Use `WebRTCTransport.connect()` to instantiate. */
export class WebRTCTransport implements P2PTransport {
  /** The incoming RPC requests in an `AsyncGenerator`. */
  public rpc?: RPCServer = undefined;

  private constructor(
    /** A bidirectional channel for control messages. */
    public messages: Libp2pStreamChannel,

    public stream: Stream,

    /** Promise that is resolved or rejected when the transport is closed. */
    public closed: Promise<unknown>,

    /** The underlying [`LibP2P`]() node. */
    private node: Libp2p
  ) {}

  // establish the connection
  public static async connect(url: string): Promise<WebRTCTransport> {
    // establish connection and wait for readiness
    const node = await createLibp2p(options(url));

    const { stream, messages } = await new Promise<{
      stream: Stream;
      messages: Libp2pStreamChannel;
    }>(async (resolve, reject) => {
      setTimeout(() => reject(new Error("timeout")), 1000 * 60 * 1);

      await node.handle(
        WASMOFF_MSG_PROTOCOL,
        async ({ stream, connection }) => {
          console.log(
            `--- opened chat stream over ${connection.multiplexer} ---`
          );
          try {
            const messages = new Libp2pStreamChannel(stream);

            node.removeEventListener("peer:connect");
            resolve({ stream, messages });
          } catch (e) {
            reject(e);
          }
        }
      );

      node.addEventListener("peer:connect", (ev) => {
        node
          .getConnections(ev.detail)
          .filter((c) => c.multiplexer?.includes("webrtc") && !c.streams.length)
          .forEach(async (c) => {
            try {
              const stream = await c.newStream(WASMOFF_MSG_PROTOCOL);
              const messages = new Libp2pStreamChannel(stream);
              resolve({ stream, messages });
            } catch (e) {
              reject(e);
            }
          });
      });
    });

    const closed = new Promise((resolve, reject) => {
      node.addEventListener( "stop", (x) => resolve("stopped"));
      // todo react to closed stream and either reconnect or stop node
      // e.g. on creating the readable and writebale, and on disconnection of the peer
    });

    return new WebRTCTransport(messages, stream, closed, node);
  }

  public async close(): Promise<void> {
    // TODO: probably needs promise cancellation in async generators to work correctly
    // https://seg.phault.net/blog/2018/03/async-iterators-cancellation/
    await Promise.allSettled([
      // (await this.rpc).return(),
      this.messages.close(),
    ]);
    return this.node?.stop();
  }

  // // await an incoming bidirectional stream for rpc requests
  // let rpc = NetRPCStreamServer(
  //   await next(transport.incomingBidirectionalStreams)
  // );

  // listen for closure and properly exit the streams
  // this.closed
  //   .then(async () => Promise.allSettled([messages.close(), rpc.return()]))
  //   .catch(() => {
  //     /* don't care */
  //   });
}

//? +---------------------------------------------------------------+
//? | Wrap a bidirectional WebTransport stream in a net/rpc server. |
//? +---------------------------------------------------------------+

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
export async function* NetRPCStreamServer(
  stream: WebTransportBidirectionalStream
): RPCServer {
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

function options(relayUrl: string): Libp2pOptions {
  return {
    transports: [
      webSockets({
        // Allow all WebSocket connections inclusing without TLS
        filter: filters.all,
      }),
      // webTransport(),
      circuitRelayTransport({
        discoverRelays: 1,
      }),
      webRTC(),
    ],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],

    // try to use a reservation on the relay
    addresses: {
      listen: ["/webrtc"],
    },

    // discover peers through the relay to avoid manually dialing
    peerDiscovery: [
      bootstrap({
        list: [relayUrl],
      }),
      pubsubPeerDiscovery({
        interval: 1000,
        topics: ["wasmoff/discovery"],
      }),
    ],

    // add services for relaying
    services: {
      identify: identify(),
      pubsub: pubsub(),
    },

    connectionGater: {
      denyDialMultiaddr: async () => false,
    },
  };
}
