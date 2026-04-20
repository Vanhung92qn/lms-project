import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SandboxClient } from './sandbox/sandbox.client';

/**
 * Assessment bounded context — students submit code, orchestrator grades
 * it, we persist the verdict + per-test results. Depends on IamModule for
 * the JwtAuthGuard and on the global PrismaModule.
 */
@Module({
  imports: [IamModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SandboxClient],
  exports: [SubmissionsService],
})
export class AssessmentModule {}
