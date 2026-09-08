import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AuthenticatedUser, IdentityProvider } from './types.js';

type JwtIdentityProviderOptions = {
  issuer: string;
  audience: string;
  jwksUrl: string;
};

function claimsToUser(subject: string, claims: JWTPayload): AuthenticatedUser {
  const roles = Array.isArray(claims.roles) ? claims.roles.filter((role): role is string => typeof role === 'string') : [];
  const schoolIds = Array.isArray(claims.school_ids)
    ? claims.school_ids.filter((schoolId): schoolId is string => typeof schoolId === 'string')
    : [];

  return {
    subject,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    displayName: typeof claims.name === 'string' ? claims.name : undefined,
    roles,
    schoolIds,
    canViewAllSchools: claims.can_view_all_schools === true
  };
}

export function createJwtIdentityProvider(options: JwtIdentityProviderOptions): IdentityProvider {
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl));

  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: options.issuer,
        audience: options.audience
      });
      if (!payload.sub) throw new Error('JWT subject is required');
      return claimsToUser(payload.sub, payload);
    }
  };
}
