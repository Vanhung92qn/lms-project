import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('users')
@Controller({ path: 'me', version: '1' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Profile of the authenticated caller' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.selectProfile(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update the authenticated profile (display_name / locale / avatar_url)' })
  async update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    // Avatar URL: empty string clears; non-empty must be https://… — we validate
    // here rather than in the DTO so "" is a valid clearing signal.
    let avatarUrl: string | null | undefined = undefined;
    if (typeof dto.avatar_url === 'string') {
      if (dto.avatar_url === '') {
        avatarUrl = null;
      } else if (!/^https?:\/\//i.test(dto.avatar_url)) {
        throw new BadRequestException({
          code: 'invalid_avatar_url',
          message: 'avatar_url must start with http:// or https://',
        });
      } else {
        avatarUrl = dto.avatar_url;
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        displayName: dto.display_name,
        locale: dto.locale,
        avatarUrl,
      },
    });

    return this.selectProfile(user.id);
  }

  private async selectProfile(userId: string) {
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
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
