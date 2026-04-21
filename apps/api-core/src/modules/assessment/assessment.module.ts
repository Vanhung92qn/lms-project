import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SandboxClient } from './sandbox/sandbox.client';

/**
 * Assessment bounded context — students submit code, orchestrator grades
 * it, we persist the verdict + per-test results. Imports KnowledgeModule
 * to fire a mastery rebuild after every AC submission.
 */
@Module({
  imports: [IamModule, KnowledgeModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SandboxClient],
  exports: [SubmissionsService],
})
export class AssessmentModule {}
