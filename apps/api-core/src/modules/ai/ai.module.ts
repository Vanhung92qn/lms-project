import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { RedisCounter } from './redis.provider';
import { TutorTierResolver } from './tier-resolver.service';
import { TutorController } from './tutor.controller';

@Module({
  imports: [IamModule, TelemetryModule],
  controllers: [TutorController],
  providers: [RedisCounter, TutorTierResolver],
})
export class AiModule {}
