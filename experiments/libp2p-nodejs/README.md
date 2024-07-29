# Local `libp2p` Example

This is a demonstration using [`js-libp2p`](https://github.com/libp2p/js-libp2p), adapted from [the `auto-relay/` example](https://github.com/libp2p/js-libp2p/tree/master/examples/auto-relay).

* It Uses WebSockets, CircuitRelay, and WebRTC transports.
* The Relay advertises itself for reservations.
* The Listener takes a reservation and starts listening on the relayed transport.
* The Dialer connects to the Relay and participates in the PubSub PeerDiscovery to get the Listener's address.
* In this simple example, you can also directly construct the Listener's address – assuming that it already has a reservation – but this way the demonstration also utilizes a builtin discovery mechanism.

### How to run the demonstration:

1. Run the **Relay** and copy its listening address:
   ```
   $ npm run dev-relay
   ...
   [NODE] 12D3KooWD91XkY...
   [LISTEN] [
     '/dns4/localhost/tcp/30000/ws/p2p/12D3KooWD91XkY...'
   ]
   
   ```

**for node:**

2. Start the **Listener** by specifying the address from above as an argument:
   ```
   $ npm run listener /dns4/localhost/tcp/30000/ws/p2p/12D3KooWD91XkY...
   ...
   ```

   This will yield a relayed WebRTC listening address (which begins with the Relay's multiaddress) after a while:
   ```
   ...
   [LISTEN] [
     '/dns4/localhost/tcp/30000/ws/p2p/12D3KooWD91XkY.../p2p-circuit/webrtc/p2p/12D3KooWAjDkhp...'
   ]
   
   ```

3. Start the **Dialer** to open the chat by specifying the Relay's address and the Listener's Peer ID as arguments:
   ```
   $ npm run dialer /dns4/localhost/tcp/30000/ws/p2p/12D3KooWD91XkY... /webrtc/p2p/12D3KooWAjDkhp...
   ...
   ```

   This will take a moment as the node waits for the desired Peer ID to appear in its PeerStore through PubSub discovery. Then the protocol is opened and you can start chatting between Listener and Dialer.


**for the browser:**

2. Serve a website which can act either as **Listener** or **Dialer** with the addresses hardcoded for the moment:
   ```
   $ npm run dev-browser
   ...
   ```

   Open a browser with two tabs or two browsers (when running on WSL, a browser in WSL!) on the specified port and open the console. Click either button for Listener or Dialer and a stream will be opened. Hello World messages wil be exchanged between both instances.

Note that listener and dialer can be both node instances, both browser instances or either or.