//parse the query string for args
function query_string(q,s) {
	s = s ? s : window.location.search;
	let re = new RegExp('&'+q+'(?:=([^&]*))?(?=&|$)','i');
	return (s=s.replace(/^?/,'&').match(re)) ? (typeof s[1] == 'undefined' ? '' : decodeURIComponent(s[1])) : undefined;
}

let region = query_string("region")
let mode = "CTF" //TODO: query_string("mode") + support multi mode
let mods = (query_string("mods") == "true")
let mods = query_string("mods")

//build the ws url + connect
let url = "ws://" + window.location.hostname + ":" + window.location.port + "/ws";
let ws = new WebSocket( url );
ws.addEventListener("open", function (event) {
	//connected
	ws.send("Hello Server, I'll close in a second!");
	//
	ws.addEventListener("close", function (event) {

	})
	//update state from server
	ws.addEventListener("message", function (event) {
		let message = event.data;
	})
	//
	setTimeout(function() {
		ws.close();
	}, 1000);
});