package api

import (
    "gotutorial/internal/websocket"
    "net/http"

    "github.com/gin-gonic/gin"
)

// CreateRoom handles POST /rooms. Rooms are created lazily on first join,
// so this endpoint simply validates input and acknowledges.
func CreateRoom(c *gin.Context){
    var req struct{
        RoomID string `json:"room_id"`
    }

    if err := c.BindJSON(&req); err != nil || req.RoomID == "" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid room_id"})
        return
    }

    c.JSON(http.StatusOK, gin.H{"message": "Room ready", "room_id": req.RoomID})
}

// JoinRoom handles GET /rooms/:id/join via WebSocket. It will create the
// room on demand when the client registers with the hub.
func JoinRoom(hub *websocket.Hub) gin.HandlerFunc{
    return func (c *gin.Context){
        roomID := c.Param("id")
        if roomID == "" {
            c.JSON(http.StatusBadRequest, gin.H{"error":"Missing room id"})
            return
        }
        websocket.HandleConnections(hub, c.Writer, c.Request, roomID)
    }
}

// SendMessage handles POST /rooms/:id/message. If a room has no clients yet,
// the message is still published to Kafka and will be delivered to any
// currently connected clients in that room.
func SendMessage(hub *websocket.Hub) gin.HandlerFunc{
    return func (c *gin.Context){
        roomID := c.Param("id")

        var req struct{
            Message string `json:"message"`
        }

        if err := c.BindJSON(&req); err != nil || req.Message == "" {
            c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid message"})
            return
        }

        hub.BroadcastToRoom(roomID, []byte(req.Message))
        c.JSON(http.StatusOK, gin.H{"message": "Message sent to room", "room_id": roomID})
    }
}
