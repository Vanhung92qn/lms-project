import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { ListLeaderboardEntriesQueryDto } from './dto/list-leaderboard-entries.query';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('leaderboards')
@Controller({ version: '1' })
export class LeaderboardController {
  constructor(private readonly svc: LeaderboardService) {}

  @Get('leaderboards')
  @ApiOperation({ summary: 'List all available leaderboards' })
  list() {
    return this.svc.list();
  }

  @Get('leaderboards/:id')
  @ApiOperation({ summary: 'Get leaderboard metadata' })
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Get('leaderboards/:id/entries')
  @ApiOperation({ summary: 'List leaderboard entries (cursor by rank)' })
  entries(@Param('id') id: string, @Query() query: ListLeaderboardEntriesQueryDto) {
    return this.svc.entries(id, query.cursor, query.limit ?? 20);
  }

  @Get('leaderboards/:id/entries/around-me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Show entries around the current user rank' })
  aroundMe(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.svc.aroundMe(id, user.id);
  }
}
