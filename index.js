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
let KAGPartyClient = {};

//queue joining algorithm
/*
(separate per-mode)

if(no players)
{
	start queue
	start timer at 5min
}
if(not many players)
{
	join single queue (ignore region)
}
else if(passed threshold for multiple queues)
{
	if(only one queue)
	{
		re-cluster players
	}

	join queue with most region affinity
}

if(queue hit play threshold or queue timer expired)
{
	start game!
}
else if(queue hit timer threshold)
{
	cut timer to 1min
}

*/

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
