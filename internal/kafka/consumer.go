package kafka

import (
	"context"
	"encoding/json"
	"gotutorial/internal/websocket"

	"log"

	"github.com/segmentio/kafka-go"
)

// Consumer listens for Kafka messages and broadcasts them to WebSocket clients
type Consumer struct {
	reader *kafka.Reader
	hub    *websocket.Hub

}
type KafkaMessage struct {
	RoomID  string `json:"room_id"`
	Message string `json:"message"`
}


// NewConsumer creates a Kafka consumer instance
func NewConsumer(brokers []string, topic string, group string, hub *websocket.Hub) *Consumer {
	return &Consumer{
		reader: kafka.NewReader(kafka.ReaderConfig{
			Brokers: brokers,
			Topic:   topic,
			GroupID: group,
		}),
		hub:hub,
	}
}

// ConsumeMessages listens for messages from Kafka and forwards them to the hub
func (c *Consumer) ConsumeMessages() {
    for {
		
        m, err := c.reader.ReadMessage(context.Background())
        if err != nil {
            log.Printf("⚠️ Consumer error: %v", err)
            continue
        }
        log.Printf("📩 Message received from Kafka: %s", string(m.Value))

        // Broadcast the Kafka message to all connected WebSocket clients
        var km KafkaMessage
        if err := json.Unmarshal(m.Value, &km); err != nil {
            log.Printf("❌ Invalid Kafka message format: %v", err)
            continue
        }

        // Broadcast to all clients in the same room WITHOUT re-publishing to Kafka
        c.hub.BroadcastLocal(km.RoomID, []byte(km.Message))
        log.Printf("📨 Broadcasted message from Kafka to room %s: %s", km.RoomID, km.Message)
    }
}

// Close closes the Kafka reader gracefully
func (c *Consumer) Close() {
	if err := c.reader.Close(); err != nil {
		log.Printf("⚠️ Error closing Kafka consumer: %v", err)
	}
}

	
