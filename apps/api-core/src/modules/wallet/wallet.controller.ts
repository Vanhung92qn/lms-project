import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { WalletService } from './wallet.service';

class CreateTopupDto {
  @IsInt()
  @Min(100_000)          // 1,000 VND floor in cents; service bumps to 10,000 VND
  @Max(50_000_000_00)    // 500M VND ceiling
  amount_cents!: number;

  @IsIn(['momo', 'bank'])
  method!: 'momo' | 'bank';

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  user_note?: string;
}

class PurchaseDto {
  @IsString()
  @MaxLength(120)
  course_slug!: string;
}

class AdminDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  admin_note?: string;
}

/**
 * Wallet endpoints. Student owns balance + top-up requests + course
 * purchases; admin owns top-up approval. Course purchase is zero-admin
 * once balance is funded — the admin only ever reviews money movement,
 * not access.
 */
@ApiTags('wallet')
@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(
    private readonly svc: WalletService,
    private readonly config: ConfigService,
  ) {}

  /** Public — MoMo / bank metadata shown in the top-up modal. */
  @Get('instructions')
  @ApiOperation({ summary: 'Payment instructions (MoMo + bank) for the FE' })
  instructions() {
    const b = this.config.get<Record<string, string | undefined>>('app.billing') ?? {};
    return {
      momo: {
        phone: b.momoPhone ?? '',
        holder: b.momoHolder ?? '',
        qrUrl: b.momoQrUrl ?? '',
      },
      bank: {
        bin: b.bankBin ?? '',
        name: b.bankName ?? '',
        account: b.bankAccount ?? '',
        holder: b.bankHolder ?? '',
      },
      currency: 'VND',
    };
  }

  // ---- Student ----------------------------------------------------------

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current wallet balance' })
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.getBalance(user.id);
  }

  @Post('me/topups')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a pending top-up request' })
  createTopup(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTopupDto) {
    return this.svc.createTopup(user, {
      amountCents: dto.amount_cents,
      method: dto.method,
      userNote: dto.user_note,
    });
  }

  @Get('me/topups')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Own top-up history (all statuses)' })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listMine(user.id);
  }

  @Patch('me/topups/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel own pending top-up' })
  cancelMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.cancelMine(user.id, id);
  }

  @Post('me/purchase')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buy a paid course with wallet balance' })
  purchase(@CurrentUser() user: AuthenticatedUser, @Body() dto: PurchaseDto) {
    return this.svc.purchase(user, dto.course_slug);
  }

  // ---- Admin ------------------------------------------------------------

  @Get('admin/topups')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all top-ups (admin only), optionally filter by status' })
  listForAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: 'pending' | 'approved' | 'rejected' | 'cancelled',
  ) {
    return this.svc.listForAdmin(user, status);
  }

  @Patch('admin/topups/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a pending top-up — credits the wallet balance' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminDecisionDto,
  ) {
    return this.svc.approve(user, id, dto.admin_note);
  }

  @Patch('admin/topups/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a pending top-up with an admin note' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminDecisionDto,
  ) {
    return this.svc.reject(user, id, dto.admin_note);
  }
}
