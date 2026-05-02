package services

import (
	"context"
	"fmt"

	"backend/domain"

	"google.golang.org/api/idtoken"
)

type RealGoogleVerifier struct{}

func NewGoogleVerifier() RealGoogleVerifier {
	return RealGoogleVerifier{}
}

func (verifier RealGoogleVerifier) Verify(ctx context.Context, rawIDToken string, audience string) (domain.GoogleIdentity, error) {
	payload, validateErr := idtoken.Validate(ctx, rawIDToken, audience)
	if validateErr != nil {
		return domain.GoogleIdentity{}, validateErr
	}

	email, emailOK := payload.Claims["email"].(string)
	subject, subjectOK := payload.Claims["sub"].(string)
	if !emailOK || !subjectOK || email == "" || subject == "" {
		return domain.GoogleIdentity{}, fmt.Errorf("Google token missing required claims")
	}

	identity := domain.GoogleIdentity{
		Subject:       subject,
		Email:         email,
		EmailVerified: claimBool(payload.Claims["email_verified"]),
	}
	if displayName, displayNameOK := payload.Claims["name"].(string); displayNameOK {
		identity.DisplayName = displayName
	}
	if picture, pictureOK := payload.Claims["picture"].(string); pictureOK && picture != "" {
		identity.AvatarURL = &picture
	}
	return identity, nil
}

func claimBool(value any) bool {
	switch typedValue := value.(type) {
	case bool:
		return typedValue
	case string:
		return typedValue == "true"
	default:
		return false
	}
}
