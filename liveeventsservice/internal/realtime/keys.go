package realtime

func wsConnectionKey(connectionID string) string {
	return "ws:conn:" + connectionID
}

func diagramConnectionsKey(diagramID string) string {
	return "diagram:" + diagramID + ":connections"
}

func diagramPresenceKey(diagramID string) string {
	return "diagram:" + diagramID + ":presence"
}

func diagramActiveUsersKey(diagramID string) string {
	return "diagram:" + diagramID + ":active_users"
}

func diagramUpdatesChannel(diagramID string) string {
	return "pubsub:diagram:" + diagramID + ":updates"
}

func diagramPresenceChannel(diagramID string) string {
	return "pubsub:diagram:" + diagramID + ":presence"
}
