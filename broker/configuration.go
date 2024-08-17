package main

// Configuration via environment variables with github.com/kelseyhightower/envconfig.
type Configuration struct {

	// HttpListen is the TCP port to listen on with the normal HTTP server
	HttpListen string `split_words:"true" default:":4080"`

	// QuicListen is the UDP port to listen on with a QUIC server for WebTransport connections
	QuicListen string `split_words:"true" default:":4443"`

	// QuicCert and QuicKey are paths to the TLS certificate and key to use for the QUIC server,
	// instead of generating a new one dynamically on startup
	QuicCert string `split_words:"true" default:""`
	QuicKey  string `split_words:"true" default:""`

	// Https will reuse the TLS config of the QUIC server for the HTTP server, whether it's
	// an ephemeral keypair or specified files.
	Https bool `split_words:"true" default:"false"`

	// TransportURL is the URL that is given to external clients to connect to the WebTransport socket
	TransportURL string `split_words:"true" default:"https://localhost:4443/transport"`

	// RelayURL is the URL that is given to external clients to connect to the relay
	RelayURL string `split_words:"true" default:"/dns4/localhost/tcp/30000/ws/p2p/12D3KooWD91XkY9wXXwQBXYWoLdS5EiB3fu3MXoax2X3erowywwK"`

	// StaticFiles is the path to the directory with the webprovider frontend dist
	StaticFiles string `split_words:"true" default:"../webprovider/dist/"`
}
