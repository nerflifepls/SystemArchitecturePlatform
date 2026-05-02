package postgre

import (
	"time"

	"backend/domain"

	"github.com/jackc/pgx/v5/pgtype"
)

type scanner interface {
	Scan(destinations ...any) error
}

func scanUser(row scanner) (domain.User, error) {
	var user domain.User
	var avatarURL pgtype.Text
	var lastLoginAt pgtype.Timestamptz
	if scanErr := row.Scan(&user.ID, &user.GoogleSub, &user.Email, &user.EmailVerified, &user.DisplayName, &avatarURL, &user.CreatedAt, &user.UpdatedAt, &lastLoginAt); scanErr != nil {
		return domain.User{}, scanErr
	}
	user.AvatarURL = textPtr(avatarURL)
	user.LastLoginAt = timePtr(lastLoginAt)
	return user, nil
}

func scanUserWithPrefix(row scanner, prefixDestinations ...any) (domain.User, error) {
	var user domain.User
	var avatarURL pgtype.Text
	var lastLoginAt pgtype.Timestamptz
	destinations := append(prefixDestinations, &user.ID, &user.GoogleSub, &user.Email, &user.EmailVerified, &user.DisplayName, &avatarURL, &user.CreatedAt, &user.UpdatedAt, &lastLoginAt)
	if scanErr := row.Scan(destinations...); scanErr != nil {
		return domain.User{}, scanErr
	}
	user.AvatarURL = textPtr(avatarURL)
	user.LastLoginAt = timePtr(lastLoginAt)
	return user, nil
}

func scanWorkspaceMember(row scanner) (domain.WorkspaceMember, error) {
	var member domain.WorkspaceMember
	var role string
	user, scanErr := scanUserWithPrefix(row, &member.WorkspaceID, &role, &member.JoinedAt)
	if scanErr != nil {
		return domain.WorkspaceMember{}, scanErr
	}
	member.Role = domain.Role(role)
	member.User = user
	return member, nil
}

func scanProject(row scanner) (domain.Project, error) {
	var project domain.Project
	var description pgtype.Text
	if scanErr := row.Scan(&project.ID, &project.WorkspaceID, &project.Name, &description, &project.CreatedBy, &project.CreatedAt, &project.UpdatedAt); scanErr != nil {
		return domain.Project{}, scanErr
	}
	project.Description = textPtr(description)
	return project, nil
}

func scanDiagram(row scanner) (domain.Diagram, error) {
	var diagram domain.Diagram
	var thumbnailURL pgtype.Text
	if scanErr := row.Scan(&diagram.ID, &diagram.ProjectID, &diagram.Title, &thumbnailURL, &diagram.SnapshotBytes, &diagram.SnapshotVersion, &diagram.SnapshotBaseUpdateSeq, &diagram.LastUpdateSeq, &diagram.CreatedBy, &diagram.CreatedAt, &diagram.UpdatedAt); scanErr != nil {
		return domain.Diagram{}, scanErr
	}
	diagram.ThumbnailURL = textPtr(thumbnailURL)
	return diagram, nil
}

func scanDiagramUpdate(row scanner) (domain.DiagramUpdate, error) {
	var update domain.DiagramUpdate
	if scanErr := row.Scan(&update.DiagramID, &update.Seq, &update.UpdateID, &update.ClientID, &update.AuthorUserID, &update.UpdateBytes, &update.CreatedAt); scanErr != nil {
		return domain.DiagramUpdate{}, scanErr
	}
	return update, nil
}

func textPtr(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	text := value.String
	return &text
}

func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	readTime := value.Time
	return &readTime
}
