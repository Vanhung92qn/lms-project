import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { TutorController } from './tutor.controller';

@Module({
  imports: [IamModule],
  controllers: [TutorController],
})
export class AiModule {}
