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
import { Libp2pStreamChannel } from "./message-stream.js";

// const WEBRTC_PROTOCOL = "/webrtc-signaling/0.0.1";
const WASMOFF_CHAT_PROTOCOL = "/wasmoff/chat/v1";

// var knownWebRTCPeerIds = new Set<PeerId>();

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
    webRTC(),
  ],
  connectionEncryption: [noise()],
  streamMuxers: [yamux()],

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

  messageStream(stream);
});

async function messageStream(stream: Stream) {
  const x = new Libp2pStreamChannel(stream);
  (async () => {
    for await (const message of x.channel) {
      console.info("Message: " + JSON.stringify(message));
    }
  })();

  if (stream.direction === "outbound") {
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  await x.send("Hello World");
  await x.send({
    type: "hello",
    message: {
      sent: new Date().toISOString(),
    },
  });
}

node.addEventListener("peer:connect", (ev) => {
  node
    .getConnections(ev.detail)
    .filter((c) => c.multiplexer?.includes("webrtc") && !c.streams.length)
    .forEach(async (c) => {
      const stream = await c.newStream(WASMOFF_CHAT_PROTOCOL);
      chatStream(stream);
    });
});

// node.addEventListener("peer:update", async () => {
//   const newWebRTCPeers = await node.peerStore.all({
//     filters: [(peer) => peer.protocols.includes(WEBRTC_PROTOCOL)],
//   });
//   for (const peerId of knownWebRTCPeerIds) {
//     if (!newWebRTCPeers.some((p) => p.id === peerId)) {
//       knownWebRTCPeerIds.delete(peerId);
//     }
//   }

//   const newPeers = newWebRTCPeers.filter(
//     (peer) => !knownWebRTCPeerIds.has(peer.id)
//   );
//   newPeers.forEach((peer) => {
//     knownWebRTCPeerIds.add(peer.id);
//   });

//   connect(newPeers);
// });

// async function connect(peers: Peer[]) {
//   for (const peer of peers) {
//     const existingConnections = node
//       .getConnections(peer.id)
//       .filter((c) => c.multiplexer?.includes("webrtc"));
//     if (existingConnections.length > 0) {
//       console.log("already connected to", JSON.stringify(existingConnections));
//       continue;
//     }
//     const webRTCMultiaddr = peer.addresses.find(
//       (addr) =>
//         WebRTC.matches(addr.multiaddr) &&
//         // addr.multiaddr.protoNames().includes("webrtc") &&
//         addr.multiaddr.getPeerId() === peer.id.toString()
//     )?.multiaddr;
//     if (!webRTCMultiaddr) {
//       console.error("no webrtc multiaddr found for peer", peer.id.toString());
//       continue;
//     }
//     try {
//       const stream = await node.dialProtocol(
//         webRTCMultiaddr,
//         WASMOFF_CHAT_PROTOCOL
//       );
//       chatStream(stream);
//     } catch (err) {
//       console.error("could not dial", webRTCMultiaddr, err);
//     }
//   }
// }

function chatStream(stream: Stream) {
  console.log("--- stream opened ---");
  if (jsEnv.isNode) {
    stdinToStream(stream);
  } else {
    helloWorldToStream(stream);
  }
  streamToConsole(stream);
}

// node.peerStore.addEventListener does not exist...
// node.peerStore.addEventListener("change:protocols" as any, ({ peerId, protocols }) => {
//   console.log("peer", peerId.toB58String(), "supports", protocols);
// });

// debug the pubsub messages
// import { toString } from "uint8arrays/to-string";
// node.services.pubsub.addEventListener("message", event => {
//   console.log(`  pubsub: ${event.detail.topic}:`, toString(event.detail.data));
// });
