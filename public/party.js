"use strict"

//parse the query string for args
function query_string(q) {
	let s = window.location + "";
	let re = new RegExp('&?'+q+'(?:=([^&]*))?(?=&|$)','i');
	let matches = s.match(re);
	return matches ? (matches[1] == undefined ? '' : decodeURIComponent(matches[1])) : undefined;
}

let region = (query_string("region") || "US")
let mode = (query_string("mode") || "CTF")
let mods = (query_string("mods") == "true")
let official = (query_string("official") == "true")

console.log("region", region, "mode", mode, "mods", mods, "official", official)

//build the ws url + connect
let url = "ws://" + window.location.hostname + ":" + window.location.port + "/ws";
let ws = new WebSocket( url );
ws.addEventListener("open", function (event) {
	//connected + loaded
	ws.send(JSON.stringify({
		type: "ready"
	}));
	//
	ws.addEventListener("close", function (event) {

	})
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

	})
	//
	setTimeout(function() {
		ws.close();
	}, 1000);
});