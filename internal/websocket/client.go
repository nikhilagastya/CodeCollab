package websocket

import (
	"log"
	"github.com/gorilla/websocket"
)

type Client struct {
	hub *Hub
	conn *websocket.Conn
	send chan []byte
	RoomID string
}


func(c *Client) readPump(){

	defer func(){
		c.hub.unregister <- c 
		c.conn.Close() 

	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			log.Printf("❌ Read error: %v", err)
			break
		}

		// Send message to Hub for broadcasting (and Kafka)
		c.hub.broadcast <- MessageEvent{
			RoomID:  c.RoomID,
			Message: message,
		}
	}
}

// writePump sends outgoing messages to the WebSocket client
func (c *Client) writePump() {
	defer c.conn.Close()

	for message := range c.send {
		err := c.conn.WriteMessage(websocket.TextMessage, message)
		if err != nil {
			log.Printf("❌ Write error: %v", err)
			break
		}
	}
}