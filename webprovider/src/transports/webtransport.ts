import { next } from "@/fn/utilities";
import type { RPCServer } from "./netRPCServer";
import { WebTransportMessageChannel, BrokerTransport } from "@/transports";
import { NetRPCStreamServer } from "./netRPCServer";

//? +--------------------------------------------------------------+
//? | Implement a Broker transport over a WebTransport connection. |
//? +--------------------------------------------------------------+

/** `WebTransportBroker` implements a WebTransport connection to the Broker, on
 * which there is an asymmetric channel for control messages and an async generator
 * of received RPC requests. Use `WebTransportBroker.connect()` to instantiate. */
export class WebTransportBroker implements BrokerTransport {

  private constructor(

    /** The underlying [`WebTransport`](https://developer.mozilla.org/docs/Web/API/WebTransport) connection. */
    public transport: WebTransport,

    /** Promise that is resolved or rejected when the transport is closed. */
    public closed: Promise<WebTransportCloseInfo>,
    public close: () => Promise<void>,

    /** A bidirectional channel for control messages to the Broker. */
    public messages: WebTransportMessageChannel,

    /** The incoming RPC requests in an `AsyncGenerator`. */
    public rpc: RPCServer,

  ) { };

  // establish the connection
  public static async connect(url: string, certhash?: string): Promise<WebTransportBroker> {

    // assemble options with an optional certificate hash
    let options: WebTransportOptions = { requireUnreliable: true };
    if (!!(window as any).chrome && certhash !== undefined) {
      options.serverCertificateHashes = [{
        "algorithm": "sha-256",
        "value": Uint8Array.from(certhash.match(/../g)!.map(b => parseInt(b, 16))), // parse hex to bytes
      }];
    };

    // establish connection and wait for readiness
    let transport = new WebTransport(url, options);
    await transport.ready;

    // connect the closed promise from transport
    let closed = transport.closed;
    let close = async () => {
      // TODO: probably needs promise cancellation in async generators to work correctly
      // https://seg.phault.net/blog/2018/03/async-iterators-cancellation/
      // await Promise.allSettled([
      //   (await this.rpc).return(),
      //   (await this.messages).close(),
      // ]);
      return transport.close();
    };

    // open a bidirectional stream for control messages
    let messages = new WebTransportMessageChannel(await transport.createBidirectionalStream());

    // await an incoming bidirectional stream for rpc requests
    let rpc = NetRPCStreamServer(await next(transport.incomingBidirectionalStreams));

    // listen for closure and properly exit the streams
    closed
      .then(async () => Promise.allSettled([ messages.close(), rpc.return() ]))
      .catch(() => { /* don't care */ });

    return new WebTransportBroker(transport, closed, close, messages, rpc);
  };

}
