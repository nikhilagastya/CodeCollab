package api

import (
	"gotutorial/internal/websocket"

	"github.com/gin-gonic/gin"
)


func SetupRouter(hub *websocket.Hub) *gin.Engine {
	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Room routes
	r.POST("/rooms", CreateRoom)
	r.GET("/rooms/:id/join", JoinRoom(hub))
	r.POST("/rooms/:id/message", SendMessage(hub))

	return r
}