import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { MasteryTrigger } from './mastery-trigger.service';

@Module({
  imports: [IamModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, MasteryTrigger],
  exports: [KnowledgeService, MasteryTrigger],
})
export class KnowledgeModule {}
