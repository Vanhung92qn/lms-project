import { Module } from '@nestjs/common';
import { PublicCoursesController } from './public/public-courses.controller';
import { PublicCoursesService } from './public/public-courses.service';
import { TeacherCoursesController } from './teacher/teacher-courses.controller';
import { TeacherCoursesService } from './teacher/teacher-courses.service';
import { EnrollmentController } from './enrollment/enrollment.controller';
import { EnrollmentService } from './enrollment/enrollment.service';
import { IamModule } from '../iam/iam.module';

/**
 * Catalog + CMS + Enrollment — the student-facing read side and the
 * teacher-facing write side live in the same module because they share a
 * mapper layer (mappers.ts) and the same Prisma entities. Enrollment sits
 * here too because it's a thin edge on Course.
 *
 * When Billing (P6) lands, paid enrollments will flow through
 * Billing → Entitlement → here.
 */
@Module({
  imports: [IamModule], // exports JwtAuthGuard + AuthService
  controllers: [PublicCoursesController, TeacherCoursesController, EnrollmentController],
  providers: [PublicCoursesService, TeacherCoursesService, EnrollmentService],
})
export class CatalogModule {}
