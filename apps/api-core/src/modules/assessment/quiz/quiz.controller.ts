import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../iam/auth/jwt.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/auth/auth.types';
import { QuizService } from './quiz.service';
import { QuizAttemptDto } from './dto/attempt.dto';

@ApiTags('assessment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ version: '1' })
export class QuizController {
  constructor(private readonly svc: QuizService) {}

  @Get('lessons/:id/quiz')
  // First call triggers a DeepSeek roundtrip (~3–8s); cached afterwards.
  // Rate-limit to 20/min/user to deter pathological regen floods if we ever
  // expose a regenerate endpoint; 20 is generous for genuine reload.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Get (and lazily generate) the formative quiz for a lesson' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) lessonId: string,
  ) {
    return this.svc.getOrGenerate(user, lessonId);
  }

  @Post('lessons/:id/quiz/attempts')
  // Grading is pure + cheap. 30/min is well above any reasonable human pace
  // but blocks scripted brute-force of the answer key.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Submit quiz answers and receive score + per-question feedback' })
  attempt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) lessonId: string,
    @Body() dto: QuizAttemptDto,
  ) {
    return this.svc.attempt(user, lessonId, dto);
  }

  @Post('lessons/:id/complete')
  // Cheap upsert; 20/min matches the quiz GET limit.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({
    summary: 'Mark a lesson complete without taking the quiz (idempotent)',
  })
  markComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) lessonId: string,
  ) {
    return this.svc.markComplete(user, lessonId);
  }
}
