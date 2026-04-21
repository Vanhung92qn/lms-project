import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { UserStatus } from '@prisma/client';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { AdminService } from './admin.service';

class SetStatusDto {
  @IsIn(['active', 'locked'])
  status!: 'active' | 'locked';
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  /** Platform-wide metrics for the Admin overview dashboard. */
  @Get('metrics')
  @ApiOperation({ summary: 'Platform health / revenue / engagement metrics' })
  metrics(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.metrics(user);
  }

  /** User management console. Optional filters: `q` (email/name search),
   * `role`, `status`. */
  @Get('users')
  @ApiOperation({ summary: 'List users with optional filters (admin only)' })
  listUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('status') status?: UserStatus,
  ) {
    return this.svc.listUsers(user, { q, role, status });
  }

  /** Lock or unlock a user account. Locking also revokes every active
   * refresh token so the session can't outlive the block. */
  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Set user status (active | locked)' })
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetStatusDto,
  ) {
    return this.svc.setStatus(user, id, dto.status);
  }
}
