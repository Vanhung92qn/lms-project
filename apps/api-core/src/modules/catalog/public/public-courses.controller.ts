import { Controller, Get, NotFoundException, Param, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { PublicCoursesService } from './public-courses.service';

/**
 * Anonymous catalog. Only published courses are returned. `GET /courses/:slug`
 * is public but enriches the response with `is_enrolled` when the caller
 * happens to carry a valid bearer token — we parse it lazily and treat
 * failure as "anonymous".
 */
@ApiTags('catalog')
@Controller({ path: 'courses', version: '1' })
export class PublicCoursesController {
  constructor(private readonly courses: PublicCoursesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List published courses (cursor-paginated)' })
  list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('locale') locale?: string,
  ) {
    return this.courses.list({
      cursor: cursor || undefined,
      limit: clampLimit(limit),
      locale: locale || undefined,
    });
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get a published course by slug' })
  async detail(@Param('slug') slug: string, @Req() req: Request) {
    const course = await this.courses.getBySlug(slug, optionalUserId(req));
    if (!course) {
      throw new NotFoundException({ code: 'course_not_found', message: 'Course not found' });
    }
    return course;
  }
}

function clampLimit(raw?: string): number {
  const n = Number(raw ?? 20);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(100, Math.floor(n));
}

function optionalUserId(req: Request): string | null {
  // We accept a bearer token here but do NOT require one; when it parses we
  // can tell the caller whether they're already enrolled in the course.
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  // Note: verification happens inside the service via JwtService to keep the
  // controller thin. Here we just forward the raw token.
  return header.slice(7).trim() || null;
}
