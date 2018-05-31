"use strict"

///////////////////////////////////////////////////////////////////////////////
//
//	kag.party - a queue site for king arthur's gold
//
//	TODO: https server, or ensure works behind https proxy
//
//	TODO: matchmake more actively; avoid leaving 1-2 stragglers in a queue
//		after a game started.

///////////////////////////////////////////////////////////////////////////////
//deps

const fs = require("fs");
const http = require("http");
const https = require("https");
const url = require("url");
const crypto = require("crypto");
const node_static = require("node-static");
const WebSocket = require('ws');

//helpers

//perform a http request
//cb takes (error, data)
//	error is null on success
//	data is the data received as a string (either all of it, or however much was recieved til the error occurred)
function request(url, cb)
{
	let data = '';
	(url.indexOf("https://") == https : http).get(url, (resp) => {
		resp.on('data', (chunk) => {
			data += chunk;
		});
		resp.on('end', () => {
			cb(null, data);
		});
	}).on("error", (err) => {
		cb(err, data);
	});
}

///////////////////////////////////////////////////////////////////////////////
//cli options

const config = JSON.parse(fs.readFileSync("./config.json"));
let config_defaults = {
	port: 8000,
	cache: 3600,
	timeout: 5000,
	behind_proxy: false,
};
for (let name in config_defaults) {
	if (config[name] == undefined) {
		config[name] = config_defaults[name];
	}
}

///////////////////////////////////////////////////////////////////////////////
//player

class Server {
	constructor(region, ip, port) {
		this.region = region;
		this.ip = ip;
		this.port = port;

		//updated from API
		this.name = "";
		this.players = 100;
		this.mods = false;
		this.valid = false;

		this.link = `kag://${this.ip}:${this.port}`;
		this.api_url = `https://api.kag2d.com/v1/game/thd/kag/server/${this.ip}/${this.port}/status`;

		this.update();
	}

	update() {
		request(this.api_url, (e, json) => {
			let response = null;
			try {
				response = JSON.parse(json);
			} catch (e) {
				console.error("bad json from api: ", json);
				return
			}

			this.valid = response.connectable;
			this.name = response.name;
			this.players = response.currentPlayers;
			this.mods = response.usingMods;
		})
	}

}

///////////////////////////////////////////////////////////////////////////////
//player
//
//	salted+hashed id is used instead of raw ip addr as a simple protection to the user.
class Player {
	constructor(socket, ip_addr) {
		this.connected = true;
		this.socket = socket;
		this.id = crypto.createHash('sha256').update(ip_addr).update("__player__").update(config.salt).digest('hex');

		//TODO: fetch rank from db based on id here
		this.rank = 0;

		this.name = "Anonymous";
		this.region = null;
		this.mode = null;
		this.join_time = -1;

		this.ready = false;

		this.matchmaker = null;
	}

	get wait_time() {
		return (this.join_time < 0) ? 0 : ((Date.now() - this.join_time) / 1000);
	}

	send(data) {
		if (!this.connected) return;

		this.socket.send(JSON.stringify(data));
	}

	receive(message) {
		if (!this.connected) return;

		let data = null;
		try {
			data = JSON.parse(message);
		} catch(e) {
			this.send(JSON.stringify({type: "error", reason: "json parse failed on receive"}));
			this.disconnect();
			return;
		}

		if (data.type == "update") {
			//can change some fields but not others depending on ready state
			let fields = ["name", "region", "mode"];
			if (this.ready) {
				fields = ["name"];
			}
			//actually change the fields if present in the packet
			fields.forEach((v) => {
				if (data.fields[v] != undefined) {
					this[v] = data.fields[v];
				}
			});
		} else if (data.type == "ready") {
			this.ready = true;
			this.join_time = Date.now();
		}

		//TODO: track name changes?

	}

	disconnect() {
		this.socket.close();
		this.connected = false;
		this.ready = false;
	}
}

///////////////////////////////////////////////////////////////////////////////
//actual game shedule handling logic for kag.party
//

class Matchmaker {
	constructor(args) {
		//fill out default args
		if(!args || !args.name || !args.thresholds || !args.timers || !args.servers) {
			throw "bad args to Matchmaker ctor"
		}
		this.name = args.name;
		//player thresholds
		this.thresholds = {};
		this.thresholds.play_now = args.thresholds.play_now || 10;
		this.thresholds.play_min = args.thresholds.play_min || 4;
		//timers
		this.timers = {};
		this.timers.wait_max = args.timers.wait_max || (5 * 60);
		this.timers.wait_min = args.timers.wait_min || (1 * 60);
		//other members
		this.players = [];
		this.servers = args.servers;

		this.time_to_start = -1;

		this.dirty = false;

		//keep servers up to date in the background; query 1 each interval
		//TODO: probably stagger this to smooth bandwidth spiking
		this._server_update_i = 0;
		this.server_update_interval = setInterval(function() {
			let i = this._server_update_i;
			//poll api for server info
			let s = this.servers[i];
			s.update();
			//iterate and wrap
			i = (i + 1) % this.servers.length;
			this._server_update_i = i;
		}, 5000);
		this.server_update_interval.unref();

	}

	//timer handling
	get time_to_start() {
		return (this._end_time - Date.now()) / 1000
	}

	set time_to_start(t) {
		this._end_time = Date.now() + (t * 1000)
		this.dirty = true
	}

	//map of list of players in each region
	get_region_lists() {
		let region_lists = {};
		this.players.forEach((p) => {
			let reg = p.region;
			if (!region_lists[reg]) {
				region_lists[reg] = [];
			}
			region_lists[reg].push(p);
		})
		return region_lists
	}

	add_player(player) {
		player.ready = true;

		this.players.push(player);
		this.dirty = true;
	}

	remove_player(player) {
		let i = this.players.indexOf(player);
		if (i != -1) {
			player.ready = false;

			this.players.splice(i, 1);
			this.dirty = true;
		}
	}

	//message sending
	send_all(message) {
		this.players.forEach((p) => {
			p.send(message);
		})
	}


	//logic to sync info to all players
	sync() {
		send_all({
			type: "queue sync",
			players: this.players.map(p => {name: p.name, region: p.region})
		});
	}

	//logic to start the game
	start(players) {
		//find the "most empty" servers
		let acceptable_servers = this.servers.sort((a, b) => {
			a = a.player_count
			b = b.player_count
			return (a < b) ? -1 : (a > b) ? 1 : 0;
		}).filter((s, i, a) => {
			return s.valid && s.player_count == a[0].player_count
		});

		//report failure to find a game
		if (acceptable_servers.length == 0) {
			console.error("couldn't find a suitable server for a game!");
			return;
		}

		//pick random suitable server
		let server = acceptable_servers[Math.floor(Math.random() * acceptable_servers.length)];

		//send all players to the game
		players.forEach((p) => {
			//send them a game
			p.send({
				type: "start game",
				//TODO: wrap this link in a click tracking link per-player to detect bad actors + get click-through stats
				server: server.link
			});
			//remove the players from the gamemode (they've been handled)
			this.remove_player(p);
		});

		//TODO: stats here
	}

	//gather the best-match players for a player, (up to this.thresholds.play_now)
	gather_players_for(player) {
		const limit = this.thresholds.play_now
		//initially filter for N players in same region
		let players = this.players.filter((p) => {
			return p.region == player.region
		}).slice(0, limit)
		//linear search through remaining players (in wait order)
		let i = 0;
		while (players.length < limit && i < this.players.length) {
			let p = this.players[i++];
			let added = (players.indexOf(p) != -1);
			if (!added) {
				players.push(p);
			}
		}
		return players;
	}

	//schedule games in the gamemode
	tick() {
		//first up, remove any dc'd players
		this.players.filter((p) => {
			return (!p.connected || !p.ready)
		}).forEach((p) => {
			remove_player(p);
		})

		if (this.players.length == 0) {
			//nothing more to do
			return;
		}

		//update state if it's changed
		if(this.dirty) {
			this.dirty = false;
			sync();
		}

		//players are sorted on wait time because of FIFO add
		let max_wait_time = this.players[0].wait_time;

		if(this.players.length > this.thresholds.play_min) {
			//wait at least this long
			if (max_wait_time > this.timers.wait_min)
			{
				if(
					//got enough players to get a game going
					this.players.length > this.thresholds.play_now ||
					//waited too long
					max_wait_time > this.timers.wait_max
				) {
					//gather longest-waiting players and send em off
					start(gather_players_for(this.players[0]));
				}
			}
		}

		//timer expired or filled out players
		if(this.players.length > this.thresholds.play_now || this.thresholds <= 0) {

		}
		//got enough players to step down the timer
		else if(this.time_to_start > this.timer_wait_min && this.players.length > this.gamemode.thresholds.play_min) {
			this.time_to_start = this.gamemode.timer_wait_min;
		}
	}
}

/*
	//server definitions
	//could probably be moved to a config file somewhere tbh

		//CTF
			new Server("EU", "138.201.55.232", 10592),
			new Server("EU", "138.201.55.232", 10594),
			new Server("EU", "138.201.55.232", 10596),
			new Server("US", "162.221.187.210", 10610),
			new Server("US", "162.221.187.210", 10617),
			new Server("AU", "108.61.212.78", 10649 ),

		//TDM
			new Server("EU", "138.201.55.232", 10600),
			new Server("EU", "138.201.55.232", 10762),
			new Server("US", "162.221.187.210", 10611),
			new Server("US", "162.221.187.210", 10761),
			new Server("US", "162.221.187.210", 10615),
			new Server("AU", "108.61.212.78", 10651 ),
			new Server("AU", "108.61.212.78", 10763 ),
		}

		//TTH
			new Server("EU", "138.201.55.232", 10595),
			new Server("US", "162.221.187.210", 10612),
			new Server("US", "162.221.187.210", 10616),
			new Server("AU", "108.61.212.78", 10650 ),
*/

//actual
let gamemodes = [
	new Gamemode({
		name: "TDM",
		thresholds: {
			play_now: 6,
			play_min: 2,
		},
		timers: {
			wait_max: (5 * 60),
			wait_min: (1 * 60),
		},
		servers: [
			new Server("EU", "138.201.55.232", 10600),
			new Server("EU", "138.201.55.232", 10762),
			new Server("US", "162.221.187.210", 10611),
			new Server("US", "162.221.187.210", 10761),
			new Server("US", "162.221.187.210", 10615),
			new Server("AU", "108.61.212.78", 10651 ),
			new Server("AU", "108.61.212.78", 10763 )
		]
	}),
	new Gamemode({
		name: "CTF",
		thresholds: {
			play_now: 10,
			play_min: 4,
		},
		timers: {
			wait_max: (5 * 60),
			wait_min: (1 * 60),
		},
		servers: [
			new Server("EU", "138.201.55.232", 10592),
			new Server("EU", "138.201.55.232", 10594),
			new Server("EU", "138.201.55.232", 10596),
			new Server("US", "162.221.187.210", 10610),
			new Server("US", "162.221.187.210", 10617),
			new Server("AU", "108.61.212.78", 10649 )
		]
	}),
	new Gamemode({
		name: "TTH",
		thresholds: {
			play_now: 10,
			play_min: 4,
		},
		timers: {
			wait_max: (5 * 60),
			wait_min: (1 * 60),
		},
		servers: [
			new Server("EU", "138.201.55.232", 10595),
			new Server("US", "162.221.187.210", 10612),
			new Server("US", "162.221.187.210", 10616),
			new Server("AU", "108.61.212.78", 10650 )
		]
	})
]

//update at 10hz
const update_interval = setInterval(function () {
	gamemodes.forEach((m) => {
		m.tick();
	});
}, 100);
update_interval.unref();

//the websocket server (run behind our http server)
const wss = new WebSocket.Server({ noServer: true });

//ws connection handling
wss.on('connection', function connection(ws, req) {
	//new ws connection

	//get the address
	let socket = req.connection;
	let ip = socket.remoteAddress;
	if (config.behind_proxy) {
		ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
	}

	ws.send(JSON.stringify({
		type: "available",
		entries: gamemodes.map((g) => {
			return {
				name: g.name,
				regions: g.servers.reduce((a, s) => {
					if (a.indexOf(s.region) == -1) {
						a.push(s.region);
					}
					return a;
				}, [])
			}
		})
	}))

	ws.on('message', function ws_message(data) {
		//handle a message from this socket
	});

	ws.on('close', function ws_message(data) {
		//remove this socket
	});

	//(required for timeouts to work)
	ws.is_alive = true;
	ws.on('pong', function heartbeat() {
		this.is_alive = true;
	});
});

//timeout inactive sockets (doesn't keep the event loop alive)
const timeout_interval = setInterval(function ping() {
	wss.clients.forEach((ws) => {
		if (!ws.is_alive) {
			return ws.terminate();
		}
		ws.is_alive = false;
		ws.ping(() => {});
	});
}, config.timeout);
timeout_interval.unref();

///////////////////////////////////////////////////////////////////////////////
//static file server from public/
const static_serve = new node_static.Server("./public", {
	cache: config.cache,
})

//actual http server
const server = http.createServer((req, res) => {
	const pathname = url.parse(req.url).pathname;
	if (pathname == "/ws") {
		//establish websocket connection incoming
	} else {
		//let static server handle it
		req.addListener('end', () => {
			static_serve.serve(req, res, (err, result) => {
				if (err) {
					//file not found or similar
					res.writeHead(err.status, err.headers);
					res.end();
				} else {
					//static file served
				}
			});
		}).resume();
	}
});

//websocket upgrade
server.on('upgrade', function upgrade(request, socket, head) {
	const pathname = url.parse(request.url).pathname;

	if (pathname === '/ws') {
		wss.handleUpgrade(request, socket, head, (ws) => {
			wss.emit('connection', ws, request);
		});
	} else {
		//bad upgrade
		socket.destroy();
	}
});

//client protocol screwup
server.on('clientError', (err, socket) => {
	socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(config.port);
