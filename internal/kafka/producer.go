package kafka

import (
	"context"
	"log"

	"github.com/segmentio/kafka-go"
)


type Producer struct{
	writer *kafka.Writer
}

func NewProducer(brokers []string, topic string)*Producer{
	return &Producer{
		writer: &kafka.Writer{
			Addr:     kafka.TCP(brokers...),
			Topic:    topic,
			Balancer: &kafka.LeastBytes{},
		},
	}
}

func (p* Producer) Publish(msg []byte)error{
	return p.writer.WriteMessages(context.Background(),kafka.Message{Value: msg})
}

func (p *Producer) Close(){
	if err:= p.writer.Close(); err!=nil{
		log.Printf("⚠️ Error closing producer: %v", err)
	}
}