package postgre

import (
	"strings"
	"testing"
)

func TestSnapshotHistoryMigrationIsEmbedded(t *testing.T) {
	content, readErr := migrationFiles.ReadFile("migrations/002_diagram_snapshot_history.up.sql")
	if readErr != nil {
		t.Fatalf("snapshot history migration is not embedded: %v", readErr)
	}

	source := string(content)
	for _, requiredSQL := range []string{
		"create table if not exists diagram_snapshots",
		"primary key (diagram_id, snapshot_version)",
		"insert into diagram_snapshots",
		"from diagrams",
		"on conflict (diagram_id, snapshot_version) do nothing",
	} {
		if !strings.Contains(source, requiredSQL) {
			t.Errorf("migration does not contain %q", requiredSQL)
		}
	}
}
