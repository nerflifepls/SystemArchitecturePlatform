package domain

import (
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleEditor Role = "editor"
	RoleViewer Role = "viewer"
)

func (role Role) Valid() bool {
	switch role {
	case RoleOwner, RoleAdmin, RoleEditor, RoleViewer:
		return true
	default:
		return false
	}
}

func (role Role) CanManageWorkspace() bool {
	return role == RoleOwner || role == RoleAdmin
}

func (role Role) CanEdit() bool {
	return role == RoleOwner || role == RoleAdmin || role == RoleEditor
}

func (role Role) CanDeleteContent() bool {
	return role == RoleOwner || role == RoleAdmin
}

type GoogleIdentity struct {
	Subject       string
	Email         string
	EmailVerified bool
	DisplayName   string
	AvatarURL     *string
}

type User struct {
	ID            uuid.UUID  `json:"id"`
	GoogleSub     string     `json:"-"`
	Email         string     `json:"email"`
	EmailVerified bool       `json:"-"`
	DisplayName   string     `json:"name"`
	AvatarURL     *string    `json:"avatarUrl"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	LastLoginAt   *time.Time `json:"lastLoginAt,omitempty"`
}

type Session struct {
	ID         string    `json:"id"`
	UserID     uuid.UUID `json:"userId"`
	GoogleSub  string    `json:"-"`
	Email      string    `json:"email"`
	Name       string    `json:"name"`
	AvatarURL  *string   `json:"avatarUrl"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

type Workspace struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	CreatedBy uuid.UUID `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type WorkspaceWithRole struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Role      Role      `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type WorkspaceMember struct {
	WorkspaceID uuid.UUID `json:"workspaceId"`
	User        User      `json:"user"`
	Role        Role      `json:"role"`
	JoinedAt    time.Time `json:"joinedAt"`
}

type Project struct {
	ID          uuid.UUID `json:"id"`
	WorkspaceID uuid.UUID `json:"workspaceId"`
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	CreatedBy   uuid.UUID `json:"createdBy"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Diagram struct {
	ID                    uuid.UUID `json:"id"`
	ProjectID             uuid.UUID `json:"projectId"`
	Title                 string    `json:"title"`
	ThumbnailURL          *string   `json:"thumbnailUrl"`
	SnapshotBytes         []byte    `json:"-"`
	SnapshotVersion       int64     `json:"snapshotVersion"`
	SnapshotBaseUpdateSeq int64     `json:"-"`
	LastUpdateSeq         int64     `json:"lastUpdateSeq"`
	CreatedBy             uuid.UUID `json:"createdBy"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type DiagramUpdate struct {
	DiagramID    uuid.UUID `json:"diagramId"`
	Seq          int64     `json:"seq"`
	UpdateID     uuid.UUID `json:"updateId"`
	ClientID     string    `json:"clientId"`
	AuthorUserID uuid.UUID `json:"authorUserId"`
	UpdateBytes  []byte    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
}

type DiagramAccess struct {
	Allowed     bool      `json:"allowed"`
	Role        Role      `json:"role"`
	DiagramID   uuid.UUID `json:"-"`
	ProjectID   uuid.UUID `json:"-"`
	WorkspaceID uuid.UUID `json:"-"`
	User        User      `json:"user"`
}
