import {
  Body,
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { TutorTierResolver } from './tier-resolver.service';

class TutorHistoryItem {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(8000)
  content!: string;
}

class AskTutorDto {
  @IsOptional()
  @IsIn(['fix-error', 'code-review', 'concept-explain'])
  intent?: 'fix-error' | 'code-review' | 'concept-explain';

  @IsOptional()
  @IsIn(['vi', 'en'])
  locale?: 'vi' | 'en';

  /**
   * Scope hint used to resolve the user's AI tier: lesson → course →
   * entitlement. Optional so ad-hoc tutor queries (not tied to a lesson)
   * still work — those always resolve to Llama.
   */
  @IsOptional()
  @IsUUID()
  lesson_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lesson_title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16_000)
  student_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8_000)
  compiler_error?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  verdict?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  question?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TutorHistoryItem)
  history?: TutorHistoryItem[];
}

/**
 * Thin proxy in front of ai-gateway. Responsibilities we keep in api-core
 * rather than ai-gateway:
 *   - AuthN (Bearer JWT via JwtAuthGuard).
 *   - Per-user rate limit (Throttle 10/min/user).
 *   - Input validation (class-validator on DTO).
 *   - **Provider selection.** We resolve the user's AI tier from DB
 *     (lesson → course → entitlement) and forward `provider` to the
 *     gateway so it knows whether to hit Llama or DeepSeek. The gateway
 *     stays stateless about billing.
 *   - Correlation — user id + provider stamped into logs.
 *
 * The response body is copied verbatim from ai-gateway → student as
 * `text/event-stream`.
 */
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'ai/tutor', version: '1' })
export class TutorController {
  private readonly log = new Logger(TutorController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tier: TutorTierResolver,
  ) {}

  @Post('ask')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Stream an AI tutor reply (SSE).' })
  async ask(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AskTutorDto,
    @Res() res: Response,
  ): Promise<void> {
    const gateway =
      this.config.get<string>('app.ai.gatewayUrl') ?? 'http://127.0.0.1:5002';

    const decision = await this.tier.resolve(user, dto.lesson_id);
    this.log.log(
      `tutor ask user=${user.id} provider=${decision.provider} reason=${decision.reason}` +
        (decision.remaining != null ? ` remaining=${decision.remaining}` : ''),
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // A non-standard header so the FE can show a "Powered by DeepSeek" badge
    // without having to parse the `done` frame.
    res.setHeader('X-Tutor-Provider', decision.provider);
    res.flushHeaders();

    const payload = { ...dto, provider: decision.provider };

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${gateway}/v1/tutor/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      this.log.warn(`ai-gateway unreachable: ${(e as Error).message}`);
      res.write(
        `event: error\ndata: {"code":"upstream_unreachable","message":"AI service is offline"}\n\n`,
      );
      res.end();
      return;
    }

    if (!upstream.ok || !upstream.body) {
      throw new InternalServerErrorException({
        code: 'ai_upstream_error',
        message: `ai-gateway returned ${upstream.status}`,
      });
    }

    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
    } catch (e) {
      this.log.warn(`stream piping failed: ${(e as Error).message}`);
    } finally {
      res.end();
    }
  }
}
