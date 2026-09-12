package realtime

import "testing"

func TestRedisKeys(t *testing.T) {
	diagramID := "diagram-1"
	connectionID := "connection-1"

	tests := []struct {
		name string
		got  string
		want string
	}{
		{name: "connection", got: wsConnectionKey(connectionID), want: "ws:conn:connection-1"},
		{name: "diagram connections", got: diagramConnectionsKey(diagramID), want: "diagram:diagram-1:connections"},
		{name: "diagram presence", got: diagramPresenceKey(diagramID), want: "diagram:diagram-1:presence"},
		{name: "active users", got: diagramActiveUsersKey(diagramID), want: "diagram:diagram-1:active_users"},
		{name: "updates channel", got: diagramUpdatesChannel(diagramID), want: "pubsub:diagram:diagram-1:updates"},
		{name: "presence channel", got: diagramPresenceChannel(diagramID), want: "pubsub:diagram:diagram-1:presence"},
		{name: "user events channel", got: userEventsChannel("user-1"), want: "pubsub:user:user-1:events"},
		{name: "workspace events channel", got: workspaceEventsChannel("workspace-1"), want: "pubsub:workspace:workspace-1:events"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.got != test.want {
				t.Fatalf("got %q, want %q", test.got, test.want)
			}
		})
	}
}
