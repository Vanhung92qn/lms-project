import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SandboxClient } from './sandbox/sandbox.client';
import { QuizController } from './quiz/quiz.controller';
import { QuizService } from './quiz/quiz.service';
import { QuizAiClient } from './quiz/quiz-ai.client';

/**
 * Assessment bounded context — students submit code, orchestrator grades
 * it, we persist the verdict + per-test results. Also hosts the P9.0
 * formative-quiz flow for non-code lessons (same mastery signal path).
 * Imports KnowledgeModule to fire a mastery rebuild after every AC
 * submission or passing quiz attempt.
 */
@Module({
  imports: [IamModule, KnowledgeModule],
  controllers: [SubmissionsController, QuizController],
  providers: [SubmissionsService, SandboxClient, QuizService, QuizAiClient],
  exports: [SubmissionsService],
})
export class AssessmentModule {}
