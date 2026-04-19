import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/auth/jwt.guard';
import type { AuthenticatedUser } from '../../iam/auth/auth.types';
import { EnrollmentService } from './enrollment.service';

// `slug` is the stable public identifier; we let the client enrol by slug
// so it doesn't have to round-trip through UUIDs. Single flat endpoint —
// `POST /enrollments` + `GET /me/enrollments` keeps the surface small.
class EnrollDto {
  @IsString()
  @Length(3, 80)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  course_slug!: string;
}

@ApiTags('enrollment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ version: '1' })
export class EnrollmentController {
  constructor(private readonly svc: EnrollmentService) {}

  @Post('enrollments')
  @HttpCode(201)
  @ApiOperation({ summary: 'Enroll the caller into a published course' })
  enroll(@CurrentUser() user: AuthenticatedUser, @Body() dto: EnrollDto) {
    return this.svc.enrollBySlug(user, dto.course_slug);
  }

  @Get('me/enrollments')
  @ApiOperation({ summary: "List the caller's enrolled courses" })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.myEnrolledCourses(user);
  }
}
