import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { KnowledgeService } from './knowledge.service';

class TagLessonDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  node_slugs!: string[];
}

@ApiTags('knowledge')
@Controller({ path: 'knowledge', version: '1' })
export class KnowledgeController {
  constructor(private readonly svc: KnowledgeService) {}

  /** Public — any visitor can browse the vocabulary. */
  @Get('nodes')
  @ApiOperation({ summary: 'List knowledge nodes (optionally filter by domain)' })
  list(@Query('domain') domain?: string) {
    return this.svc.listNodes(domain);
  }

  /** Public — returns the full nodes + edges graph. Used by the admin KG
   * viewer and the next-lesson recommender. Small payload (<10 KB)
   * because the vocabulary stays small by design. */
  @Get('graph')
  @ApiOperation({ summary: 'Full knowledge graph (nodes + edges)' })
  graph() {
    return this.svc.fullGraph();
  }

  /** Student-scoped: the authenticated user's mastery rows. */
  @Get('me/mastery')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user mastery scores for all touched nodes' })
  mineMastery(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listMastery(user.id);
  }

  /** Teacher-scoped: replace the knowledge tags on a lesson they own. */
  @Put('lessons/:lessonId/tags')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace knowledge-node tags on a lesson (teacher-owned)' })
  tagLesson(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lessonId', new ParseUUIDPipe()) lessonId: string,
    @Body() dto: TagLessonDto,
  ) {
    return this.svc.tagLesson(lessonId, user.id, dto.node_slugs);
  }
}
