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
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../iam/auth/jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../iam/auth/auth.types';
import { BillingService } from './billing.service';

class CreatePaymentDto {
  @IsString()
  @MaxLength(120)
  course_slug!: string;

  @IsIn(['momo', 'bank'])
  method!: 'momo' | 'bank';

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  user_note?: string;
}

class AdminDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  admin_note?: string;
}

/**
 * Student endpoints for creating and tracking payments + admin endpoints
 * for approving / rejecting. Payment instructions (MoMo phone, bank
 * account…) live in config and are exposed via a small public endpoint
 * so the FE renders them without hardcoding.
 */
@ApiTags('billing')
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(
    private readonly svc: BillingService,
    private readonly config: ConfigService,
  ) {}

  /** Public — MoMo / bank metadata shown in the purchase form. */
  @Get('instructions')
  @ApiOperation({ summary: 'Payment instructions (MoMo + bank) for the FE form' })
  instructions() {
    const b = this.config.get<Record<string, string | undefined>>('app.billing') ?? {};
    return {
      momo: {
        phone: b.momoPhone ?? '',
        holder: b.momoHolder ?? '',
        qrUrl: b.momoQrUrl ?? '',
      },
      bank: {
        name: b.bankName ?? '',
        account: b.bankAccount ?? '',
        holder: b.bankHolder ?? '',
      },
      currency: 'VND',
    };
  }

  // ---- Student ----------------------------------------------------------

  @Post('payments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a pending payment for a paid course' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentDto) {
    return this.svc.createPending(user, {
      courseSlug: dto.course_slug,
      method: dto.method,
      userNote: dto.user_note,
    });
  }

  @Get('me/payments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user payment history' })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.listMine(user.id);
  }

  @Patch('me/payments/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a pending payment the caller owns' })
  cancelMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.svc.cancelMine(user.id, id);
  }

  // ---- Admin ------------------------------------------------------------

  @Get('admin/payments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all payments (admin only), optionally filtered by status' })
  listForAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: 'pending' | 'approved' | 'rejected' | 'cancelled',
  ) {
    return this.svc.listForAdmin(user, status);
  }

  @Patch('admin/payments/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a pending payment (grants entitlement + enrolment)' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminDecisionDto,
  ) {
    return this.svc.approve(user, id, dto.admin_note);
  }

  @Patch('admin/payments/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a pending payment with an admin note' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AdminDecisionDto,
  ) {
    return this.svc.reject(user, id, dto.admin_note);
  }
}
