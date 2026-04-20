import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { TelemetryService } from './telemetry.service';

class AppendChatDto {
  @IsOptional()
  @IsUUID()
  lesson_id?: string;

  @IsIn(['llama', 'deepseek'])
  provider!: 'llama' | 'deepseek';

  @IsIn(['vi', 'en'])
  locale!: 'vi' | 'en';

  @IsString()
  @MaxLength(2_000)
  user_message!: string;

  @IsString()
  @MaxLength(8_000)
  assistant_message!: string;
}

class SaveSnapshotDto {
  @IsUUID()
  lesson_id!: string;

  @IsString()
  @MaxLength(16)
  language!: string;

  @IsString()
  @MaxLength(32_000)
  source!: string;
}

class RecordEventDto {
  @IsOptional()
  @IsUUID()
  lesson_id?: string;

  @IsString()
  @MaxLength(64)
  event!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Write-only telemetry endpoints used by the web player and tutor panel.
 * Student-facing read APIs (chat history drawer, "mastery of the week")
 * ship in P5b/c and will live on their own controllers.
 *
 * Rate limits are generous — telemetry is best-effort and we'd rather
 * drop occasional writes than throttle a student who's actively coding.
 */
@ApiTags('telemetry')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'telemetry', version: '1' })
export class TelemetryController {
  constructor(private readonly svc: TelemetryService) {}

  @Post('chat')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: 'Append a tutor turn to the student session' })
  async appendChat(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AppendChatDto,
  ): Promise<{ ok: true }> {
    await this.svc.appendChat({
      userId: user.id,
      lessonId: dto.lesson_id ?? null,
      provider: dto.provider,
      locale: dto.locale,
      userMessage: dto.user_message,
      assistantMessage: dto.assistant_message,
    });
    return { ok: true };
  }

  @Post('snapshot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Persist a 30s editor autosave' })
  async saveSnapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveSnapshotDto,
  ): Promise<{ ok: true }> {
    await this.svc.saveSnapshot({
      userId: user.id,
      lessonId: dto.lesson_id,
      language: dto.language,
      source: dto.source,
    });
    return { ok: true };
  }

  @Post('event')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @ApiOperation({ summary: 'Record a learning event (click/submit/focus/etc)' })
  async recordEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordEventDto,
  ): Promise<{ ok: true }> {
    await this.svc.recordEvent({
      userId: user.id,
      lessonId: dto.lesson_id ?? null,
      event: dto.event,
      metadata: dto.metadata,
    });
    return { ok: true };
  }
}
