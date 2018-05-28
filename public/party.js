var url = "ws://" + window.location.hostname + ":" + window.location.port + "/ws";
console.log("hello kagparty, connect websocket on "+url);
var ws = new WebSocket( url );

ws.addEventListener("open", function (event) {
    ws.send("Hello Server, I'll close in a second!");
    setTimeout(function() {
    	ws.close();
    }, 1000);
});