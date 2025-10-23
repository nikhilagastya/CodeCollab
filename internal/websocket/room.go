package websocket

type Room struct {
	ID string
	clients map[*Client]bool
}

func NewRoom(id string) *Room{
	return &Room{
		ID: id,
		clients: make(map[*Client]bool),
	}
}