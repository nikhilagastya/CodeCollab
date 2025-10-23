package common

type MessagePublisher interface {
    Publish(msg []byte) error
}