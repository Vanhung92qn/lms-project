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

  private requireTeacher(user: AuthenticatedUser): void {
    if (!user.roles.includes('teacher') && !user.roles.includes('admin')) {
      throw new ForbiddenException({
        code: 'forbidden_by_policy',
        message: 'Teacher role required',
      });
    }
  }
}
