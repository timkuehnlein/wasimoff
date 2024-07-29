// collect a few common logging functions etc.

import { Libp2p } from "libp2p";
import { Libp2pEvents } from "@libp2p/interface";

// some known public bootstrap servers
export const publicBootstrap = [
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
];

// print the node's peerid
export function printNodeId(node: Libp2p) {
  console.log("\x1b[1;31m[NODE]\x1b[0m", node.peerId.toString());
}

// print the node's listening multiaddrs
export function printListeningAddrs(node: Libp2p) {
  node.addEventListener("self:peer:update", () => {
    console.log(
      "\x1b[1;32m[LISTEN]\x1b[0m",
      node.getMultiaddrs().map((ma) => ma.toString())
    );
  });
}

// print peerid whenever a dial succeeds or a peer disconnects
export function printPeerConnections(node: Libp2p) {
  node.addEventListener("peer:connect", (ev) => {
    console.log("\x1b[1;34m[CONNECT]\x1b[0m", ev.detail.toString());
  });
  node.addEventListener("peer:disconnect", (ev) => {
    console.log("\x1b[1;34m[DISCONNECT]\x1b[0m", ev.detail.toString());
  });
}

// print some information whenever a new peer is discovered
export function printPeerDiscoveries(node: Libp2p) {
  node.addEventListener("peer:discovery", (ev) => {
    console.log("\x1b[1;33m[DISCOVER]\x1b[0m", JSON.stringify(ev.detail));
  });
}

// print the updated peerstore on specific events
export function printPeerStoreUpdates(
  node: Libp2p,
  event: keyof Libp2pEvents = "peer:update"
) {
  node.addEventListener(event, async () => {
    console.log(
      "\x1b[1;35m[PEERSTORE]\x1b[0m",
      (await node.peerStore.all()).reduce(
        (acc, peer) =>
          Object.assign(acc, {
            [peer.id.toString()]: {
              addresses: peer.addresses.map((a) => a.multiaddr.toString()),
              protocols: peer.protocols,
              metadata: Array.from(peer.metadata.entries()).reduce(
                (acc, [k, v]) =>
                  Object.assign(acc, { [k]: "0x" + v.toString() }),
                {}
              ),
              tags: Array.from(peer.tags.entries()).reduce(
                (acc, [k, v]) => Object.assign(acc, { [k]: v.value }),
                {}
              ),
            },
          }),
        {}
      )
    );
  });
}
