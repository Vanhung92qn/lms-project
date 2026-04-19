export type OAuthProvider = 'google' | 'github';

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
}

/**
 * Minimal profile shape we care about. Providers return far more, we ignore
 * the rest. `providerId` is the stable unique id at the provider (sub / id).
 */
export interface NormalizedProfile {
  providerId: string;
  email: string | null; // GitHub may keep email private — handled by caller
  displayName: string;
  avatarUrl: string | null;
}
