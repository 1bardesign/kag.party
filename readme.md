# kag.party

A matchmaking queue website for King Arthur's Gold.

Work in progress.

# Design

Absolute minimum friction website for entering a waiting queue for a kag server.

Pick a region and gamemode, wait for a game, hit the button.

Should make some attempt at limiting users from greifing the system; considering either KAG API SSO or simple accounts or session matching as part of kag.party. The latter with tracked click-through rates may be a good way of doing things. IP-linked anonymous accounts are probably trivial too, but still require some set-up on our end. Rate-limiting poorly behaving accounts probably limits the damage.

Operates on an internal whitelist of servers in each region, randomly assigns games to help "seed" play.

# Dependencies

	node
	ws
		async-limiter
	node-static
		colors
		mime
		optimist
			minimist
			wordwrap

# Setup

	(clone this repo)
	npm install
	cp config-example-dev.json config.json

# Running

	node index.js

# Config

Handled by an out-of-repo config file; examples configs are in `config-example-*.json`

- `"port"` <br>
	the outbound port to serve content on
- `"cache"` <br>
	cache control header (consider "no-cache, must-revalidate" for dev, ~3600 for prod)
- `"behind_proxy"` <br>
	whether we're behind a proxy or not; determines where a client's IP is fetched from (the socket, or x-forwarded-for header)
- `"timeout"` <br>
	the maximum time without a ping response that a socket is kept alive for, in milliseconds
- `"salt"` <br>
	a string used as part of the salt used in any hashing operations (extra fragments are used in code as a contingency about this being empty)


# License

Currently unlicensed - will likely open source (MIT or similar) once things are functional.
