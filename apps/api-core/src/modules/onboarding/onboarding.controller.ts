import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { OnboardingService } from './onboarding.service';
import { UpsertOnboardingDto } from './dto/upsert-onboarding.dto';

@ApiTags('onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/onboarding', version: '1' })
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get()
  // Cheap read. 60/min is far above any reasonable polling cadence.
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOperation({ summary: "Get the caller's onboarding profile (null if not yet filled)" })
  async get(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.svc.findByUserId(user.id);
    return { profile };
  }

  @Put()
  // Upserts are cheap + idempotent; 20/min lets a user re-submit without
  // being locked out by a double-click but kills brute-forcing.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({
    summary: 'Create or update the caller onboarding profile (goals + level + pace)',
  })
  async upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertOnboardingDto) {
    const profile = await this.svc.upsert(user.id, dto);
    return { profile };
  }
}
