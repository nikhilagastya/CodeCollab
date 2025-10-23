package main

import (
	"gotutorial/internal/api"
	"gotutorial/internal/config"
	"gotutorial/internal/kafka"
	"gotutorial/internal/websocket"
	"log"
)

func main() {
	cfg := config.Load()

	// Initialize Kafka Producer
	producer := kafka.NewProducer(cfg.KafkaBrokers, cfg.KafkaTopic)

	// Create WebSocket Hub
	hub := websocket.NewHub(producer)
	go hub.Run()

	// Initialize Kafka Consumer (listens for messages and rebroadcasts)
	consumer := kafka.NewConsumer(cfg.KafkaBrokers, cfg.KafkaTopic, "chat-group", hub)
	go consumer.ConsumeMessages()

	// Setup HTTP routes
	r := api.SetupRouter(hub)

	log.Printf("🚀 Server running on port %s", cfg.ServerPort)
	r.Run(":" + cfg.ServerPort)
}
