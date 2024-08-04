// auto-relay listener from https://github.com/libp2p/js-libp2p/tree/master/examples/auto-relay

import { createLibp2p } from "libp2p";
// import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
// import { mplex } from "@libp2p/mplex";
import { multiaddr, Multiaddr } from "@multiformats/multiaddr";
import { WebRTC } from "@multiformats/multiaddr-matcher";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { bootstrap } from "@libp2p/bootstrap";
import { floodsub as pubsub } from "@libp2p/floodsub";
// import { gossipsub as pubsub } from "@chainsafe/libp2p-gossipsub";
import { pubsubPeerDiscovery } from "@libp2p/pubsub-peer-discovery";
import figlet from "figlet";
import {
  helloWorldToStream,
  stdinToStream,
  streamToConsole,
} from "./stream.js";
import * as cm from "./common.js";
import { webRTC } from "@libp2p/webrtc";
import { yamux } from "@chainsafe/libp2p-yamux";
// import { webTransport } from "@libp2p/webtransport";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import * as jsEnv from "browser-or-node";
import type { Stream } from "@libp2p/interface";
import { pullStream } from "./pull.js";
import {
  exampleInteropLender,
  pipeNumberToString,
} from "./pull-stream-lender.js";

// const WEBRTC_PROTOCOL = "/webrtc-signaling/0.0.1";
const WASMOFF_CHAT_PROTOCOL = "/wasmoff/chat/v1";

// --- prelude -------------------------------------------------------------- //

var relay: Multiaddr | undefined = undefined;
if (jsEnv.isNode) {
  // print banner
  console.log(figlet.textSync("auto generic peer", { font: "Small" }));

  // relay address expected in argument
  if (!process.argv[2]) throw new Error("relay address expected in argument");
  relay = multiaddr(process.argv[2]);
} else {
  console.log("Using default relay address");
  relay = multiaddr(
    "/ip4/127.0.0.1/tcp/30000/ws/p2p/12D3KooWD91XkY9wXXwQBXYWoLdS5EiB3fu3MXoax2X3erowywwK"
  );
}

// --- constructor ---------------------------------------------------------- //

// create the client node
const node = await createLibp2p({
  transports: [
    // not possible in browsers
    // tcp(),
    webSockets({
      // Allow all WebSocket connections inclusing without TLS
      filter: filters.all,
    }),
    // webTransport(),
    circuitRelayTransport({
      discoverRelays: 1,
    }),
    // configuration with small windows does not result in backpressure
    // { dataChannel: { maxMessageSize: 16, maxBufferedAmount: 16 } }
    webRTC(),
  ],
  connectionEncryption: [noise()],
  streamMuxers: [
    // allows backpressure, whereas mplex does not
    // default: { initialStreamWindowSize: 1024 * 256, maxStreamWindowSize: 16 * 1024 * 1024 }
    // does not run with lower values than { initialStreamWindowSize: 1024 * 256, maxStreamWindowSize: 1024 * 256 * 1 }
    yamux(),
  ],

  // try to use a reservation on the relay
  addresses: {
    listen: [
      // cannot listen in browser
      // relay.encapsulate("/p2p-circuit").toString(),
      "/webrtc",
    ],
  },

  // discover peers through the relay to avoid manually dialing
  peerDiscovery: [
    bootstrap({
      list: [relay.toString()],
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
});

// --- implementation ------------------------------------------------------- //

// log information
cm.printNodeId(node);
cm.printPeerConnections(node);
cm.printPeerDiscoveries(node);
cm.printListeningAddrs(node); // print own multiaddr once we have a relay
cm.printPeerStoreUpdates(node, "peer:update");

// handle a simple chat protocol
await node.handle(WASMOFF_CHAT_PROTOCOL, async ({ stream, connection }) => {
  console.log(`--- opened chat stream over ${connection.multiplexer} ---`);
  // pullStream(stream);
  pipeNumberToString(stream);
});

node.addEventListener("peer:connect", (ev) => {
  node
    .getConnections(ev.detail)
    .filter((c) => c.multiplexer?.includes("webrtc") && !c.streams.length)
    .forEach(async (c) => {
      const stream = await c.newStream(WASMOFF_CHAT_PROTOCOL);
      // pullStream(stream);
      exampleInteropLender(stream);
    });
});

function chatStream(stream: Stream) {
  console.log("--- stream opened ---");
  if (jsEnv.isNode) {
    stdinToStream(stream);
  } else {
    helloWorldToStream(stream);
  }
  streamToConsole(stream);
}

// debug the pubsub messages
// import { toString } from "uint8arrays/to-string";
// node.services.pubsub.addEventListener("message", event => {
//   console.log(`  pubsub: ${event.detail.topic}:`, toString(event.detail.data));
// });
