import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../iam/auth/jwt.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/auth/auth.types';
import { TeacherCoursesService } from './teacher-courses.service';
import { CreateCourseDto } from '../dto/create-course.dto';
import {
  CreateLessonDto,
  CreateModuleDto,
  UpdateCourseDto,
  UpdateLessonDto,
  UpdateModuleDto,
} from '../dto/update-course.dto';

// Every endpoint here requires an authenticated teacher or admin. Students who
// hit this subtree get 403. Ownership checks live in the service — only an
// admin bypass is handled here.
@ApiTags('teacher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'teacher/courses', version: '1' })
export class TeacherCoursesController {
  constructor(private readonly courses: TeacherCoursesService) {}

  @Get()
  @ApiOperation({ summary: 'List courses the caller owns (admin sees all)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    this.requireTeacher(user);
    return this.courses.listMine(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail of a course owned by the caller (any status)' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.requireTeacher(user);
    return this.courses.detail(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new course (draft)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCourseDto) {
    this.requireTeacher(user);
    return this.courses.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a course (owner or admin)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    this.requireTeacher(user);
    return this.courses.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a course' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    this.requireTeacher(user);
    await this.courses.remove(user, id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a draft course' })
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.requireTeacher(user);
    return this.courses.publish(user, id);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: 'Move a published course back to draft' })
  unpublish(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.requireTeacher(user);
    return this.courses.unpublish(user, id);
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Aggregated metrics for a course (enrolments, submissions, AC rate, weakest concepts)' })
  analytics(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.requireTeacher(user);
    return this.courses.analytics(user, id);
  }

  // -------- P9.1 Teacher Insight endpoints --------------------------------

  @Get(':id/heatmap')
  @ApiOperation({ summary: 'Classroom heatmap: enrolled students × tagged concepts grid with BKT mastery scores' })
  heatmap(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.requireTeacher(user);
    return this.courses.heatmap(user, id);
  }

  @Get(':id/tutor-insights')
  @ApiOperation({ summary: 'Most-recent student questions to the AI Tutor, joined with lesson titles' })
  tutorInsights(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.requireTeacher(user);
    return this.courses.tutorInsights(user, id);
  }

  @Get(':id/coverage')
  @ApiOperation({ summary: 'Concept coverage: which KG nodes are taught by this course vs missing; missing prereqs flagged' })
  coverageGap(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.requireTeacher(user);
    return this.courses.coverageGap(user, id);
  }

  @Post(':id/modules')
  @ApiOperation({ summary: 'Append a new module to a course' })
  addModule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') courseId: string,
    @Body() dto: CreateModuleDto,
  ) {
    this.requireTeacher(user);
    return this.courses.addModule(user, courseId, dto);
  }

  @Post(':id/modules/:moduleId/lessons')
  @ApiOperation({ summary: 'Append a new lesson to a module' })
  addLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') courseId: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: CreateLessonDto,
  ) {
    this.requireTeacher(user);
    return this.courses.addLesson(user, courseId, moduleId, dto);
  }

  @Patch(':id/modules/:moduleId')
  @ApiOperation({ summary: 'Update a module (title, sort order)' })
  updateModule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') courseId: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: UpdateModuleDto,
  ) {
    this.requireTeacher(user);
    return this.courses.updateModule(user, courseId, moduleId, dto);
  }

  @Delete(':id/modules/:moduleId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a module (cascades lessons, exercises, submissions)' })
  async removeModule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') courseId: string,
    @Param('moduleId') moduleId: string,
  ): Promise<void> {
    this.requireTeacher(user);
    await this.courses.removeModule(user, courseId, moduleId);
  }

  @Get(':id/modules/:moduleId/lessons/:lessonId')
  @ApiOperation({ summary: 'Fetch a single lesson in full (includes content_markdown) for editing' })
  getLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') courseId: string,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
  ) {
    this.requireTeacher(user);
    return this.courses.getLessonForEdit(user, courseId, moduleId, lessonId);
  }

  @Patch(':id/modules/:moduleId/lessons/:lessonId')
  @ApiOperation({
    summary: 'Update a lesson (title, content, type, estimated minutes)',
  })
  updateLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') courseId: string,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
    @Body() dto: UpdateLessonDto,
  ) {
    this.requireTeacher(user);
    return this.courses.updateLesson(user, courseId, moduleId, lessonId, dto);
  }

  @Delete(':id/modules/:moduleId/lessons/:lessonId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a lesson (cascades exercise + submissions)' })
  async removeLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') courseId: string,
    @Param('moduleId') moduleId: string,
    @Param('lessonId') lessonId: string,
  ): Promise<void> {
    this.requireTeacher(user);
    await this.courses.removeLesson(user, courseId, moduleId, lessonId);
  }

  private requireTeacher(user: AuthenticatedUser): void {
    if (!user.roles.includes('teacher') && !user.roles.includes('admin')) {
      throw new ForbiddenException({
        code: 'forbidden_by_policy',
        message: 'Teacher role required',
      });
    }
  }
}
