import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { SubmissionsService } from './submissions.service';
import { SubmitDto } from './dto/submit.dto';

@ApiTags('assessment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ version: '1' })
export class SubmissionsController {
  constructor(private readonly svc: SubmissionsService) {}

  @Post('submissions')
  // Lower than the general ai-rate-limit because these are expensive to
  // grade. 10/min/user matches the AI Tutor envelope.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Submit source code for an exercise and get the verdict synchronously' })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitDto) {
    return this.svc.submit(user, dto);
  }

  @Get('submissions/:id')
  @ApiOperation({ summary: "Detail of a submission (own submissions only)" })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.findById(user, id);
  }

  @Get('me/submissions')
  @ApiOperation({ summary: 'List recent submissions for the caller on a given exercise' })
  listMine(@CurrentUser() user: AuthenticatedUser, @Query('exercise_id') exerciseId: string) {
    return this.svc.listForUserAndExercise(user, exerciseId);
  }
}
