"use strict"

///////////////////////////////////////////////////////////////////////////////
// helpers

//parse the query string for args
function query_string(q) {
	let s = window.location + "";
	let re = new RegExp('&?'+q+'(?:=([^&]*))?(?=&|$)','i');
	let matches = s.match(re);
	return matches ? (matches[1] == undefined ? '' : decodeURIComponent(matches[1])) : undefined;
}

///////////////////////////////////////////////////////////////////////////////
//script globals
//filled in when the socket is connected or by some packet result

//node we get full control over for our ui
let uinode = null;
//available info from the server on what regions/modes are actually available
//(filled in by "available" packet)
let available_gamemodes = {};


function send(obj) {
	ws.send(JSON.stringify(obj));
	console.log("send", obj);
}

//player choices
let chosen = {
	region: (query_string("region")),
	mode: (query_string("mode")),
	name: (query_string("name") || ""),
};

//
let queue_info = {
	players: [],
};

function sync()
{
	let m = {
		type: 'update',
		fields: {}
	}
	if (chosen.region) {
		m.fields.region = chosen.region;
	}
	if (chosen.mode) {
		m.fields.mode = chosen.mode;
	}
	m.fields.name = chosen.name;
	send(m);
}

//TODO: use dirty flag and send all these at once
function set_region(r) {
	chosen.region = r;
	sync();
	update();
}

function set_name(n) {
	chosen.name = n;
	sync();
	update();
}

function set_mode(m) {
	chosen.mode = m;
	sync();
	update();
}

function set_ready() {
	send({
		type: "ready"
	})
	next_state();
}

///////////////////////////////////////////////////////////////////////////////
// page states

function wait_for_connection() {
	uinode.innerHTML = `waiting for connection...`;
}

function wait_for_entries()
{
	uinode.innerHTML = `waiting for entries...`;
}

function choose_options()
{
	let ready_str = (chosen.mode && chosen.region) ?
		`<br>
		<button onclick="set_ready();">Ready!</button>` :
		"";

	uinode.innerHTML = `
		<button onclick="set_region('US');">US</button>
		<button onclick="set_region('EU');">EU</button>
		<button onclick="set_region('AU');">AU</button>
		<br>
		<button onclick="set_mode('CTF');">CTF</button>
		<button onclick="set_mode('TDM');">TDM</button>
		<button onclick="set_mode('TTH');">TTH</button>
		${ready_str}
	`;
}

function update_ready()
{
	//(todo: config?)
	const anon_name = "(Anonymous)"
	//update the count of each player
	let players_info = queue_info.players.reduce(function(o, player) {
		let n = player.name
		let c = o.names_count
		if (!c[n]) {
			c[n] = 1;
			if (n != anon_name)
			{
				o.unique_names.push(n);
			}
		} else {
			c[n]++;
		}
		o.total_count++;
		return o
	}, {
		names_count: {},
		total_count: 0,
		unique_names: [],
	});

	let players_list = players_info.unique_names.map(function(n) {
		let count = players_info.names_count[n];
		return count > 1 ? `${n} (x${count})` : n;
	}).join(", ");

	const anon_count = players_info.names_count[anon_name];
	if (anon_count != undefined && anon_count > 0) {
		if (players_list != "") {
			players_list += " and ";
		}
		players_list += `${anon_count} Anonymous Players`;
	}

	//add hyphen if needed
	if (players_list != "") {
		players_list = `(${players_list})`
	}

	uinode.innerHTML = `
		players waiting: ${players_info.total_count} ${players_list}
	`;
}

let server_name = "";
let server_link = "";

function show_game()
{
	uinode.innerHTML = `
		Game found! <br>
		Server: ${server_name} <br>
		<a href="${server_link}">Click to play!</a>
	`;
}

//trivial forward-only state machine of functions
let states = [
	wait_for_connection,
	wait_for_entries,
	choose_options,
	update_ready,
	show_game
];

function update() {
	if (states.length > 0) {
		(states[0])();
	}
}

function next_state() {
	if (states.length > 0) {
		states.shift();
		update();
	}
}

//build the ws url + connect
let url = "ws://" + window.location.hostname + ":" + window.location.port + "/ws";
let ws = new WebSocket( url );
ws.addEventListener("open", function (event) {
	//connected + loaded
	next_state();

	//(should we notify the server?)

	//fill in globals
	uinode = document.getElementById("ui");

	//note down when we're done; nothing extra for now
	ws.addEventListener("close", function (event) {
		console.log("disconnected from server");
	});

	//update state from server
	ws.addEventListener("message", function (event) {
		let message;
		try{
			message = JSON.parse(event.data);
		} catch(e) {
			console.error("JSON parse failure: ", e);
			ws.close();
			return;
		}

		//log to console for now
		console.log("message", message);

		//
		if (message.type == "available") {
			available_gamemodes = message.entries;
			next_state();
		} else if (message.type == "queue sync") {
			//TODO: check ready state
			queue_info.players = message.players;
			update();
		} else if (message.type == "start game") {
			server_name = message.name;
			server_link = message.link;
			next_state();
		}

	});
});

//on page finished loading
window.addEventListener("load", function(event) {
	//pull in page-resident globals
	uinode = document.getElementById("ui");

	update();
});