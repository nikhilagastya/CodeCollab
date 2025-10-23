package websocket 

import (
    "log"
    "net/http"
    "github.com/gorilla/websocket"
)

// Upgrader upgrades HTTP connections to WebSocket connections
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true }, // Allow any origin
}

// HandleConnections upgrades a request to WebSocket and registers a new client
func HandleConnections(hub *Hub, w http.ResponseWriter, r *http.Request ,roomID string) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("❌ WebSocket upgrade failed for room %s: %v", roomID, err)
        return
    }

	client := &Client{
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 256),
		RoomID: roomID,

	}

	// Register client in the hub
	hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	client.readPump()
}
