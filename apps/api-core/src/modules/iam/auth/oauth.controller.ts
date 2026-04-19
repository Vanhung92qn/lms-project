import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { OAuthService } from './oauth.service';
import type { OAuthProvider } from './oauth.types';

/**
 * Endpoints:
 *   GET /api/v1/auth/oauth/:provider/start     → 302 to provider consent page
 *   GET /api/v1/auth/oauth/:provider/callback  → exchange + 302 to web with tokens
 *
 * We use a `state` cookie + URL-fragment bridge so tokens never appear in
 * server logs, proxies, or the browser history bar.
 */
@ApiTags('auth')
@Controller({ path: 'auth/oauth', version: '1' })
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Public()
  @Get(':provider/start')
  @ApiOperation({ summary: 'Begin OAuth with google or github' })
  start(@Param('provider') provider: string, @Res() res: Response): void {
    const normalized = normalizeProvider(provider);
    const { url, state } = this.oauth.buildAuthorizeUrl(normalized);
    // Short-lived, strictly-scoped state cookie — readable only on callback.
    res.cookie('lms_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000,
      path: `/api/v1/auth/oauth/${normalized}/callback`,
    });
    res.redirect(302, url);
  }

  @Public()
  @Get(':provider/callback')
  @ApiOperation({ summary: 'OAuth callback handler — exchanges code and redirects to web' })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') err: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const normalized = normalizeProvider(provider);

    const web = this.oauth.webOrigin();

    if (err) {
      res.redirect(302, `${web}/auth/oauth/callback#error=${encodeURIComponent(err)}`);
      return;
    }

    const savedState = (res.req.cookies?.['lms_oauth_state'] as string | undefined) ?? null;
    // Clear cookie regardless of outcome.
    res.clearCookie('lms_oauth_state', { path: `/api/v1/auth/oauth/${normalized}/callback` });

    if (!code || !state || savedState !== state) {
      res.redirect(302, `${web}/auth/oauth/callback#error=invalid_state`);
      return;
    }

    const { redirect } = await this.oauth.handleCallback(normalized, code);
    res.redirect(302, redirect);
  }
}

function normalizeProvider(x: string): OAuthProvider {
  if (x === 'google' || x === 'github') return x;
  throw new BadRequestException({ code: 'unknown_provider', message: `Unknown provider: ${x}` });
}
