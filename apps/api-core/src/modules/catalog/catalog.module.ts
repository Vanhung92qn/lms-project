import { Module } from '@nestjs/common';
import { PublicCoursesController } from './public/public-courses.controller';
import { PublicCoursesService } from './public/public-courses.service';
import { LessonsController } from './public/lessons.controller';
import { ChallengesController } from './public/challenges.controller';
import { LeaderboardController } from './public/leaderboard.controller';
import { TeacherCoursesController } from './teacher/teacher-courses.controller';
import { TeacherCoursesService } from './teacher/teacher-courses.service';
import { EnrollmentController } from './enrollment/enrollment.controller';
import { EnrollmentService } from './enrollment/enrollment.service';
import { IamModule } from '../iam/iam.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

/**
 * Catalog + CMS + Enrollment — the student-facing read side and the
 * teacher-facing write side live in the same module because they share a
 * mapper layer (mappers.ts) and the same Prisma entities. Enrollment sits
 * here too because it's a thin edge on Course.
 *
 * Teacher insights (P9.1) reach into ai_chats via TelemetryService, which
 * is why TelemetryModule is imported here.
 */
@Module({
  imports: [IamModule, TelemetryModule],
  controllers: [
    PublicCoursesController,
    LessonsController,
    ChallengesController,
    LeaderboardController,
    TeacherCoursesController,
    EnrollmentController,
  ],
  providers: [PublicCoursesService, TeacherCoursesService, EnrollmentService],
})
export class CatalogModule {}
