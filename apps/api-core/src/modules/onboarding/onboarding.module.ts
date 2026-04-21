import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Cold-start onboarding bounded context (P9.0 PR D). Owns the
 * OnboardingProfile table and the goal → course matcher. Exports
 * `OnboardingService` so the knowledge module can cascade to it when
 * the student has no mastery rows to serve a BKT-based recommendation.
 */
@Module({
  imports: [IamModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
