// auto-relay dialer from https://github.com/libp2p/js-libp2p/tree/master/examples/auto-relay

import { createLibp2p } from "libp2p";
// import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
// import { mplex } from "@libp2p/mplex";
import { multiaddr, Multiaddr } from "@multiformats/multiaddr";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { createFromJSON } from "@libp2p/peer-id-factory";
import { peerIdFromString } from "@libp2p/peer-id";
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
import type { Stream } from "@libp2p/interface";
import { webRTC } from "@libp2p/webrtc";
import { yamux } from "@chainsafe/libp2p-yamux";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
// import { webTransport } from "@libp2p/webtransport";
import * as jsEnv from "browser-or-node";

// --- prelude -------------------------------------------------------------- //

//! load a persistent peer-id
//? (await require('peer-id').create({ keyType: "Ed25519" })).toJSON()
const ownPeerId = await createFromJSON({
  id: "12D3KooWQAkbxDYXsRBL75hzjYXDWq2ntT7U8zA2DLsVPRnEtRTg",
  privKey:
    "CAESQF+mPW4UsUKHjDjAGAqC4WLVFKOlQAEQx5cQxurgM2Nf1TyZnc4eFI3TJLmQSar77bQaWrICjvIm1N14StIzd1M=",
  pubKey: "CAESINU8mZ3OHhSN0yS5kEmq++20GlqyAo7yJtTdeErSM3dT",
});

var relay: Multiaddr | undefined = undefined;
var peer: Multiaddr | undefined = undefined;
if (jsEnv.isNode) {
  // print banner
  console.log(figlet.textSync("auto dialer", { font: "Small" }));

  // relay address expected in argument
  if (!process.argv[2])
    throw new Error("relay address expected in first argument");
  relay = multiaddr(process.argv[2]);

  // peer id expected in argument
  if (!process.argv[3]) throw new Error("peer id expected in second argument");
  peer = multiaddr(process.argv[3]);
} else {
  relay = multiaddr(
    "/ip4/127.0.0.1/tcp/30000/ws/p2p/12D3KooWD91XkY9wXXwQBXYWoLdS5EiB3fu3MXoax2X3erowywwK"
  );
  peer = multiaddr(
    "/webrtc/p2p/12D3KooWAjDkhpNMdFbmd7V4eoMBis2KKgwDwNMuiqXbT4RfCd9Z"
  );
}

const peerId = peer.getPeerId();
if (!peerId) throw new Error("peer id in second argument invalid");

// --- constructor ---------------------------------------------------------- //

// create the client node
const node = await createLibp2p({
  peerId: ownPeerId,

  // use simple tcp for now but append relay transport
  transports: [
    // not supported in browsers
    // tcp(),
    webSockets({
      // Allow all WebSocket connections inclusing without TLS
      filter: filters.all,
    }),
    circuitRelayTransport(),
    webRTC(),
  ],
  connectionEncryption: [noise()],
  streamMuxers: [yamux()],

  // we don't need to advertise anything
  // addresses: { ... }

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
cm.printPeerStoreUpdates(node, "peer:identify");

// which dial to use
const waitForDiscovery = true;

function chatStream(stream: Stream) {
  console.log("--- stream opened ---");
  if (jsEnv.isNode) {
    stdinToStream(stream);
  } else {
    helloWorldToStream(stream);
  }
  streamToConsole(stream);
}

(async () => {
  if (waitForDiscovery) {
    // wait until peerid is routable
    const pid = peerIdFromString(peerId);
    console.log("wait for peerId:", peer);
    while (
      !(await node.peerStore.has(pid)) ||
      !(await node.peerStore.get(pid)).addresses.length
    ) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // cannot dial on transient (short-lived or bandwidth limited, such as relayed) connection, but on webRTC
    // https://github.com/libp2p/specs/blob/master/relay/circuit-v2.md
    // try to dial the requested peer for chat
    const conn = await node.dialProtocol(pid, "/wasmoff/chat/v1");
    chatStream(conn);
  } else {
    // directly dial the peer by encapsulating in relay address
    const relayed = relay.encapsulate("/p2p-circuit").encapsulate(peer);
    chatStream(await node.dialProtocol(relayed, "/wasmoff/chat/v1"));
  }
})();

// dial the peer through the relay
// const conn = await node.dial(peer);
// console.log("Connected to peer:", conn.remotePeer.toString());
