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

# Running

npm start

