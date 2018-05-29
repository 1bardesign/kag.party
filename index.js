"use strict"

//TODO: https
const fs = require("fs");
const http = require("http");
const url = require("url");
const static = require("node-static");
const WebSocket = require('ws');

//cli options
const config = JSON.parse(fs.readFileSync("./config.json"));
//defaults
let defaults = {
	port: 8000,
	cache: 3600,
	behind_proxy: false,
};
for (let name in defaults) {
	if (config[name] == undefined) {
		config[name] = defaults[name];
	}
}

//client class
class Client {
	constructor() {}
}

class GamemodeQueue {
	constructor(gamemode) {
		this.gamemode = gamemode
		this.players = []
		this.done = false
		this.time_to_start = this.gamemode.timers.play_maximum
		this.dirty = false
	}

	//add a player
	add(p) {
		this.players.push(p)
		this.dirty = true
	}

	remove(p) {
		//remove a player
		let i = this.players.indexOf(p);
		if (i != -1) {
			this.players.splice(i, 1);
			this.dirty = true
		}
	}

	send(message) {
		this.players.forEach((p) => {
			//send message to each player's websocket
		})
	}

	//timer handling
	get time_to_start() {
		return (this._end_time - Date.now()) / 1000
	}

	set time_to_start(t) {
		this._end_time = Date.now() + (t * 1000)
		this.dirty = true
	}

	//logic to sync info to all players
	sync() {
		let m = {
			type: "gamemode sync",
			players: this.players.map((p) => {
				return p.name;
			}),
			time_to_start: this.time_to_start
		};

		send(JSON.stringify(m));
	}

	//logic to start the game
	start() {
		//find the "most empty" servers
		let acceptable_servers = this.gamemode.servers.sort((a, b) => {
			if (a.player_count < b.player_count) {
				return -1;
			} else if (a.player_count > b.player_count) {
				return 1;
			}
			return 0;
		}).filter((s, i, a) => {
			return s.player_count == a[0].player_count
		});
		//pick random one
		let server = acceptable_servers[Math.floor(Math.random() * acceptable_servers.length)]

		//send all players to the game
		send(JSON.stringify({
			type: "start game",
			server: server.link //TODO: wrap this in a link to track clicks + detect bad actors
		}))

		//remove the players from the gamemode (they've been handled)
		this.players.forEach((p) => {
			this.gamemode.remove_player(p)
		})
		//flag as done, to be removed from the gamemode list
		this.done = true;
	}

	tick() {
		//don't update if this has already finished
		if (this.done) {
			return;
		}

		//update state if it's changed
		if(this.dirty) {
			this.dirty = false
			sync()
		}

		//timer expired or filled out players
		if(this.players.length > this.gamemode.thresholds.play_now || this.time_to_start <= 0) {
			start();
		}
		//got enough players to step down the timer
		else if(this.time_to_start > this.gamemode.timer_play_minimum && this.players.length > this.gamemode.thresholds.play_soon) {
			this.time_to_start = this.gamemode.timer_play_minimum;
		}
	}
}

class Gamemode {
	constructor(args) {
		//fill out default args
		if(!args || !args.thresholds || !args.timers || !args.servers) {
			throw "bad args to GamemodeQueue ctor"
		}
		//player thresholds
		this.thresholds = {}
		this.thresholds.play_now = args.thresholds.play_now || 10;
		this.thresholds.play_soon = args.thresholds.play_now || 4;
		//TODO: this may be better on games per minute or something?..
		this.thresholds.multi_queue = args.thresholds.multi_queue || 8;
		//timers
		this.timers = {}
		this.timers.play_maximum = args.timers.play_maximum || (5 * 60);
		this.timers.play_minimum = args.timers.play_minimum || (1 * 60);
		//other members
		this.queues = [];
		this.players = [];
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

	//convert region list to putative queue count
	region_list_queue_count(region_list) {
		//players "reasonably" in each queue
		const players_per_queue = (this.gamemode.thresholds.play_now - 1)
		return Math.ceil(region_list.length / players_per_queue);
	}

	//split players based on region threshold
	remake_queues()
	{
		let region_lists = this.get_region_lists();

		//figure out how many queues we "should" have
		let target_queue_count = 0;
		for (let region in region_lists) {
			target_queue_count += this.region_list_queue_count(region_lists[region]);
		}
		//if we are on-track for our region count, no harm, no foul, don't remake
		if (this.queues.length >= target_queue_count) return;

		//otherwise, get current timer range
		let timer_min = this.timers.play_maximum;
		let timer_max = this.timers.play_minimum;
		this.queues.forEach((q) => {
			let t = q.time_to_start
			timer_max = Math.max(timer_max, t)
			timer_min = Math.min(timer_min, t)
		})

		//remake queues
		let new_queues = []
		for (let region in region_lists) {
			let region_list = region_lists[region]
			let target_count = this.region_list_queue_count(region_list);
			let players_per_queue = Math.ceil(region_list.length / target_count)
			for (let i = 0; i < target_count; i++) {
				let new_queue = new GamemodeQueue(this);
				new_queue.time_to_start = (timer_min + Math.random() * (timer_max - timer_min)); //assign random time based on prev queues
				//transfer players
				for(let pi = 0; pi < players_per_queue; pi++)
				{
					new_queue.add(region_list.pop());
				}
			}
		}
		//swap them out
		this.queues = new_queues
	}

	add_player(player)
	{
		let queue = null;
		if(this.queues.length == 0) //no active queues
		{
			//create new queue
			queue = new GamemodeQueue(this);
			this.queues.push(queue);
		}
		else if(this.players.length < this.thresholds.multi_queue)
		{
			//just take first queue while we're in single queue territory
			queue = this.queues[0];
		}
		else
		{
			//into multi-queue territory, but have a single queue?
			if(this.queues.length <= 1)
			{
				remake_queues();
			}

			let best_affinity = -1;
			let best_queue = null;
			this.queues.forEach((check_queue) => {
				//get queue with best region affinity
				let affinity = 0;
				check_queue.forEach((queued_player) => {
					if (queued_player.region == player.region)
					{
						affinity++;
					}
				});
				if (affinity > best_affinity) {
					best_queue = check_queue;
				}
			})
			queue = best_queue;
			//join queue with most region affinity
		}

		if(queue == null) throw "failed to find queue for player!";

		queue.add(player);
	}

	remove_player(p) {
		let i = this.players.indexOf(p);
		if (i != -1) {
			this.players.splice(i, 1);
		}
	}

	//update all queues in the gamemode
	tick()
	{
		for (let i = 0; i < this.queues.length; i++)
		{
			let queue = this.queues[i];
			//update and remove if finished
			queue.tick();
			if (queue.done)
			{
				this.queues.splice(i--, 1)
			}
		}
	}
}

//websocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', function connection(ws, req) {
	//new ws connection

	//get the address
	let ip = req.connection.remoteAddress;
	if (config.behind_proxy) {
		ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
	}

	//make note of this socket
	console.log(log_start, "connected");

	ws.on('message', function ws_message(data) {
		//handle a message from this socket
	});

	ws.on('close', function ws_message(data) {
		//remove this socket
	});
});

//static file server from public/
const static_serve = new static.Server("./public", {
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
