package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	ServerPort   string
	GinMode      string
	KafkaBrokers []string
	KafkaTopic   string
	KafkaGroup   string
}

// Load reads environment variables from .env
func Load() *Config {
	// Load .env if it exists
	if err := godotenv.Load(); err != nil {
		log.Println("⚠️ No .env file found, using system environment variables")
	}

	return &Config{
		ServerPort:   getEnv("PORT", "8080"),
		GinMode:      getEnv("GIN_MODE", "debug"),
		KafkaBrokers: []string{getEnv("KAFKA_BROKER", "localhost:9092")},
		KafkaTopic:   getEnv("KAFKA_TOPIC", "chat-messages"),
		KafkaGroup:   getEnv("KAFKA_GROUP", "chat-group"),
	}
}

// Helper: get env var or fallback
func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
