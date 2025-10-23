package websocket

import (
	"encoding/json"
	"gotutorial/internal/common"
	"log"
)


type Hub struct{
	rooms      map[string]*Room

	broadcast chan MessageEvent
	register chan *Client
	unregister chan *Client
	producer  common.MessagePublisher
}
type MessageEvent struct {
    RoomID  string
    Message []byte
    FromKafka bool
}

func NewHub(producer common.MessagePublisher) *Hub {
	return &Hub{
		rooms:      make(map[string]*Room),
		broadcast:  make(chan MessageEvent),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		producer:   producer,
	}
}



func (h *Hub) BroadcastToRoom(roomID string, msg []byte) {
    h.broadcast <- MessageEvent{
        RoomID:  roomID,
        Message: msg,
        FromKafka: false,
    }
}

// BroadcastLocal broadcasts to connected clients without publishing to Kafka.
// Used by the Kafka consumer to avoid feedback loops.
func (h *Hub) BroadcastLocal(roomID string, msg []byte) {
    h.broadcast <- MessageEvent{
        RoomID:  roomID,
        Message: msg,
        FromKafka: true,
    }
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			room, ok := h.rooms[client.RoomID]
			if !ok {
				room = NewRoom(client.RoomID)
				h.rooms[client.RoomID] = room
			}
			room.clients[client] = true
			log.Printf("🟢 Client joined room %s", client.RoomID)

		case client := <-h.unregister:
			if room, ok := h.rooms[client.RoomID]; ok {
				delete(room.clients, client)
				close(client.send)
				log.Printf("🔴 Client left room %s", client.RoomID)
			}

        case event := <-h.broadcast:
            // Publish to Kafka only if this event originated locally
            if !event.FromKafka {
                payload, _ := json.Marshal(map[string]string{
                    "room_id": event.RoomID,
                    "message": string(event.Message),
                })
                if err := h.producer.Publish(payload); err != nil {
                    log.Printf("⚠️ Kafka publish error: %v", err)
                }
            }

            // Broadcast to clients in the room only for Kafka-originated events
            if event.FromKafka {
                if room, ok := h.rooms[event.RoomID]; ok {
                    for c := range room.clients {
                        select {
                            case c.send <- event.Message:
                            default:
                                close(c.send)
                                delete(room.clients, c)
                        }
                    }
                }
            }
		}
	}
}
// func (h *Hub) BroadcastToRoom(roomID string, msg []byte) {
// 	h.broadcast <- MessageEvent{
// 		RoomID:  roomID,
// 		Message: msg,
// 	}
// }
