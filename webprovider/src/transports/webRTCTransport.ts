import type { P2PTransport } from "@/transports";
import { Libp2pStreamChannel, type P2PRPCMessage } from "@/transports";
import { gossipsub as pubsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { bootstrap } from "@libp2p/bootstrap";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import type { Stream, Connection } from "@libp2p/interface";
import { pubsubPeerDiscovery } from "@libp2p/pubsub-peer-discovery";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { createLibp2p, type Libp2p, type Libp2pOptions } from "libp2p";

//? +--------------------------------------------------------------+
//? | Implement a P2P transport over a WebRTC connection.          |
//? +--------------------------------------------------------------+

const WASMOFF_MSG_PROTOCOL = "/wasmoff/msg/0.0.1";
const WASMOFF_RPC_PROTOCOL = "/wasmoff/rpc/0.0.1";
const WASMOFF_QUEUE_PROTOCOL = "/wasmoff/queue/0.0.1";

/** `WebRTCTransport` implements a WebRTC connection to peers, on
 * which there is an asymmetric channel for control messages, an async
 * channel of RPC requests and responses, and a WASMRun queue channel.
 * Use `WebRTCTransport.connect()` to instantiate. */
export class WebRTCTransport implements P2PTransport {
  private constructor(
    /** A bidirectional RPC channel. */
    public rpc: Libp2pStreamChannel<P2PRPCMessage>,

    /** Bare stream underneath RPC channel. */
    private rpcStream: Stream,

    /** A bidirectional channel for control messages. */
    public messages: Libp2pStreamChannel,

    /** Bare stream underneath messages channel. */
    private messagesStream: Stream,

    /** A bidirectional stream of WASMRun objects to be handled and CompletedExecution objects as results */
    public queue: Stream,

    /** Promise that is resolved or rejected when the transport is closed. */
    public closed: Promise<unknown>,

    /** The underlying [`LibP2P`](https://github.com/libp2p/js-libp2p) node. */
    private node: Libp2p
  ) {}

  // establish the connection
  public static async connect(url: string): Promise<WebRTCTransport> {
    // create peer discovering libp2p node
    const node = await createLibp2p(options(url));

    // wait for a new discovered connection, then open outgoing streams
    const openStreams = async () => {
      const connection = await discoverConnection(node);
      const [messagesStream, rpcStream, queueStream] = await Promise.all([
        connection.newStream(WASMOFF_MSG_PROTOCOL),
        connection.newStream(WASMOFF_RPC_PROTOCOL),
        connection.newStream(WASMOFF_QUEUE_PROTOCOL),
      ]);
      return { messagesStream, rpcStream, queueStream };
    };

    // wait for incomming stream requests
    const acceptStreams = async () => {
      const [messagesStream, rpcStream, queueStream] = await Promise.all([
        acceptIncomingStream(node, WASMOFF_MSG_PROTOCOL),
        acceptIncomingStream(node, WASMOFF_RPC_PROTOCOL),
        acceptIncomingStream(node, WASMOFF_QUEUE_PROTOCOL),
      ]);
      return { messagesStream, rpcStream, queueStream };
    };

    // whatever works fastest, open or accept
    const { messagesStream, rpcStream, queueStream } = await Promise.race([
      openStreams(),
      acceptStreams(),
    ]);

    node.removeEventListener("peer:connect");

    const messages = new Libp2pStreamChannel(messagesStream);

    // instead of adapting to the go net rpc server, we use a simple messagepack channel with custom RPC messages
    // const rpcEncoder = NetRPCStreamEncoder(toWritableStream(rpcStream));
    // const rpc = NetRPCStreamServer(toReadableStream(rpcStream), rpcEncoder);
    const rpc = new Libp2pStreamChannel<P2PRPCMessage>(rpcStream);

    const closed = new Promise((resolve, reject) => {
      node.addEventListener("stop", (x) => resolve("stopped"));
      // todo react to closed stream and either reconnect or stop node
      // e.g. on creating the readable and writebale, and on disconnection of the peer
    });

    return new WebRTCTransport(
      rpc,
      rpcStream,
      messages,
      messagesStream,
      queueStream,
      closed,
      node
    );
  }

  public async close(): Promise<void> {
    // TODO: probably needs promise cancellation in async generators to work correctly
    // https://seg.phault.net/blog/2018/03/async-iterators-cancellation/
    await Promise.allSettled([
      this.rpc.close().then(() => this.rpcStream.close()),
      this.messages.close().then(() => this.messagesStream.close()),
      this.queue.close(),
    ]);
    return this.node?.stop();
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

function discoverConnection(node: Libp2p): Promise<Connection> {
  return new Promise<Connection>(async (resolve, reject) => {
    setTimeout(() => reject(new Error("timeout")), 1000 * 60 * 1);

    node.addEventListener("peer:connect", (ev) => {
      const connections = node
        .getConnections(ev.detail)
        .filter(
          (c) => c.multiplexer?.includes("webrtc") && c.streams.length == 0
        );
      if (connections.length == 0) return;

      resolve(connections[0]);
    });
  });
}

async function acceptIncomingStream(
  node: Libp2p,
  protocol: string
): Promise<Stream> {
  return new Promise(async (resolve, reject) => {
    await node.handle(protocol, async ({ stream, connection }) => {
      console.log(
        `--- opened ${protocol} stream over ${connection.multiplexer} ---`
      );

      resolve(stream);
    });
  });
}
