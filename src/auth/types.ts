export type AuthenticatedUser = {
  subject: string;
  email?: string;
  displayName?: string;
  roles: string[];
  schoolIds: string[];
  canViewAllSchools: boolean;
};

export type IdentityProvider = {
  verify(token: string): Promise<AuthenticatedUser>;
};
