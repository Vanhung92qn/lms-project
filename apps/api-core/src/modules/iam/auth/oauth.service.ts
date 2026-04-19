import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { AuthResponse, Role } from '@lms/shared-types';
import type {
  NormalizedProfile,
  OAuthProvider,
  OAuthProviderConfig,
} from './oauth.types';

/**
 * Manual OAuth 2.0 Authorization-Code flow for Google and GitHub.
 *
 * Why manual (vs Passport): we only need two providers at MVP, the flow is
 * ~40 lines per provider, and avoiding Passport's runtime keeps the global
 * auth guard story simple. Swap in @nestjs/passport when the provider list
 * grows or when enterprise SSO (SAML/OIDC) shows up in the backlog.
 *
 * Flow (per provider):
 *   1. /auth/oauth/:provider/start
 *        → issue cryptographically-random `state`, stash in a short-lived
 *          HttpOnly cookie, 302 to provider's authorize URL.
 *   2. Provider → /auth/oauth/:provider/callback?code=...&state=...
 *        → verify state cookie matches, exchange code for access token,
 *          fetch user profile, upsert local User + OAuthAccount, issue our
 *          own JWT pair, redirect browser to web with tokens.
 *
 * Tokens are passed via URL fragment `#access=…&refresh=…&expires=…` on the
 * post-callback redirect so they never hit server logs; the web client
 * consumes them client-side and writes to session storage.
 */
@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  private webOrigin(): string {
    // Web callback landing page (client consumes the URL fragment).
    return this.config.get<string>('app.corsOrigin') ?? 'http://localhost:3000';
  }

  private callbackUrl(provider: OAuthProvider): string {
    const publicUrl = this.config.get<string>('app.publicBaseUrl') ?? 'http://localhost:4000';
    return `${publicUrl}/api/v1/auth/oauth/${provider}/callback`;
  }

  providerConfig(provider: OAuthProvider): OAuthProviderConfig {
    if (provider === 'google') {
      return {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
        scopes: ['openid', 'email', 'profile'],
        clientId: this.config.get<string>('app.oauth.google.clientId') ?? '',
        clientSecret: this.config.get<string>('app.oauth.google.clientSecret') ?? '',
      };
    }
    if (provider === 'github') {
      return {
        authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        scopes: ['read:user', 'user:email'],
        clientId: this.config.get<string>('app.oauth.github.clientId') ?? '',
        clientSecret: this.config.get<string>('app.oauth.github.clientSecret') ?? '',
      };
    }
    throw new BadRequestException({ code: 'unknown_provider', message: `Unknown OAuth provider: ${provider}` });
  }

  buildAuthorizeUrl(provider: OAuthProvider): { url: string; state: string } {
    const cfg = this.providerConfig(provider);
    if (!cfg.clientId) {
      throw new InternalServerErrorException({
        code: 'oauth_not_configured',
        message: `OAuth provider ${provider} is not configured on this server.`,
      });
    }
    const state = randomBytes(24).toString('base64url');
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: this.callbackUrl(provider),
      response_type: 'code',
      scope: cfg.scopes.join(' '),
      state,
    });
    return { url: `${cfg.authorizeUrl}?${params.toString()}`, state };
  }

  async handleCallback(
    provider: OAuthProvider,
    code: string,
  ): Promise<{ redirect: string }> {
    const cfg = this.providerConfig(provider);

    // 1. Exchange code for access_token.
    const tokenBody = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: this.callbackUrl(provider),
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      this.log.warn(`[${provider}] token exchange HTTP ${tokenRes.status}`);
      return { redirect: this.errorRedirect('oauth_failed') };
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenJson.access_token;
    if (!accessToken) return { redirect: this.errorRedirect('oauth_failed') };

    // 2. Fetch normalized profile.
    const profile = await this.fetchProfile(provider, accessToken);
    if (!profile.email) {
      // GitHub sometimes hides primary email; treat as configuration issue for now.
      this.log.warn(`[${provider}] profile without email`);
      return { redirect: this.errorRedirect('oauth_failed') };
    }

    // 3. Upsert User + link OAuthAccount, then issue our JWT pair.
    const tokens = await this.issueFromProfile(provider, profile);

    const fragment = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: String(tokens.access_expires_in),
    });
    return {
      redirect: `${this.webOrigin()}/auth/oauth/callback#${fragment.toString()}`,
    };
  }

  private errorRedirect(code: string): string {
    return `${this.webOrigin()}/auth/oauth/callback#error=${encodeURIComponent(code)}`;
  }

  private async fetchProfile(
    provider: OAuthProvider,
    accessToken: string,
  ): Promise<NormalizedProfile> {
    const cfg = this.providerConfig(provider);
    const res = await fetch(cfg.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'ai-lms-oauth',
      },
    });
    if (!res.ok) throw new InternalServerErrorException('oauth_userinfo_failed');
    const data = (await res.json()) as Record<string, unknown>;

    if (provider === 'google') {
      return {
        providerId: String(data.sub ?? ''),
        email: typeof data.email === 'string' ? data.email : null,
        displayName: typeof data.name === 'string' ? data.name : 'Google User',
        avatarUrl: typeof data.picture === 'string' ? data.picture : null,
      };
    }
    // github
    let email = typeof data.email === 'string' ? data.email : null;
    if (!email) {
      // Fallback: fetch /user/emails and pick the primary verified.
      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'ai-lms-oauth',
        },
      });
      if (emailsRes.ok) {
        const list = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        email = list.find((e) => e.primary && e.verified)?.email ?? null;
      }
    }
    return {
      providerId: String(data.id ?? ''),
      email,
      displayName:
        (typeof data.name === 'string' && data.name) ||
        (typeof data.login === 'string' && data.login) ||
        'GitHub User',
      avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : null,
    };
  }

  private async issueFromProfile(
    provider: OAuthProvider,
    profile: NormalizedProfile,
  ): Promise<AuthResponse['tokens']> {
    // 1. If we already linked this provider id, login that user.
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerId: { provider, providerId: profile.providerId } },
      include: { user: { include: { userRoles: { include: { role: true } } } } },
    });
    if (linked) {
      const roles = linked.user.userRoles.map((ur) => ur.role.name as Role);
      return this.auth.issueTokensPublic(linked.user.id, linked.user.email, linked.user.locale, roles);
    }

    // 2. Otherwise, match by email — merge into existing account or create new.
    let user = await this.prisma.user.findUnique({
      where: { email: profile.email! },
      include: { userRoles: { include: { role: true } } },
    });

    if (!user) {
      // Random throw-away password — oauth-only accounts can't login via /auth/login
      // until the user sets one via the profile page (P2 feature).
      const passwordHash = await argon2.hash(randomBytes(32).toString('base64url'), {
        type: argon2.argon2id,
      });
      const studentRole = await this.prisma.role.findUnique({ where: { name: 'student' } });
      if (!studentRole) throw new Error('Seed error: role student missing');
      user = await this.prisma.user.create({
        data: {
          email: profile.email!,
          passwordHash,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          locale: 'vi',
          userRoles: { create: [{ roleId: studentRole.id }] },
        },
        include: { userRoles: { include: { role: true } } },
      });
    }

    // 3. Link provider → user.
    await this.prisma.oAuthAccount.create({
      data: {
        provider,
        providerId: profile.providerId,
        userId: user.id,
      },
    });

    const roles = user.userRoles.map((ur) => ur.role.name as Role);
    return this.auth.issueTokensPublic(user.id, user.email, user.locale, roles);
  }
}
