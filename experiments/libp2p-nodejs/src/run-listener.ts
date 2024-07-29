// auto-relay listener from https://github.com/libp2p/js-libp2p/tree/master/examples/auto-relay

import { createLibp2p } from "libp2p";
// import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
// import { mplex } from "@libp2p/mplex";
import { multiaddr, Multiaddr } from "@multiformats/multiaddr";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { createFromJSON } from "@libp2p/peer-id-factory";
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

// --- prelude -------------------------------------------------------------- //

//! load a persistent peer-id
//? (await require('peer-id').create({ keyType: "Ed25519" })).toJSON()
const peerId = await createFromJSON({
  id: "12D3KooWAjDkhpNMdFbmd7V4eoMBis2KKgwDwNMuiqXbT4RfCd9Z",
  privKey:
    "CAESQGg0DbD4P5WuGEy2BW+rD0bvFOxy2eO8/dr5emmGiFXJDYpEwsXmVoU21XBT5GAQrHgokJWqguHPSiZHDzEG69g=",
  pubKey: "CAESIA2KRMLF5laFNtVwU+RgEKx4KJCVqoLhz0omRw8xBuvY",
});

// print banner
if (jsEnv.isNode) {
  console.log(figlet.textSync("auto listener", { font: "Small" }));
}

var relay: Multiaddr | undefined = undefined;

if (jsEnv.isNode) {
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
  peerId,

  // use simple tcp for now but append relay transport
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
await node.handle("/wasmoff/chat/v1", async ({ stream }) => {
  console.log("--- opened chat stream ---");
  // await iostream(stream);
  if (jsEnv.isNode) {
    stdinToStream(stream);
  } else {
    helloWorldToStream(stream);
  }
  streamToConsole(stream);
});

// debug the pubsub messages
// import { toString } from "uint8arrays/to-string";
// node.services.pubsub.addEventListener("message", event => {
//   console.log(`  pubsub: ${event.detail.topic}:`, toString(event.detail.data));
// });
