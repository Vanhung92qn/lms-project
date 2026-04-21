import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { MongoService } from './mongo.service';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';

@Module({
  imports: [IamModule],
  controllers: [TelemetryController],
  providers: [MongoService, TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
