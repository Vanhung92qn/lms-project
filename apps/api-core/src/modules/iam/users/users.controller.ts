import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('users')
@Controller({ path: 'me', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() user: AuthenticatedUser) {
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { userRoles: { include: { role: true } } },
    });
    return {
      id: dbUser.id,
      email: dbUser.email,
      display_name: dbUser.displayName,
      avatar_url: dbUser.avatarUrl,
      locale: dbUser.locale,
      roles: dbUser.userRoles.map((ur) => ur.role.name),
      created_at: dbUser.createdAt.toISOString(),
    };
  }
}
