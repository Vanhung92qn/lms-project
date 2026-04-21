import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertOnboardingDto } from './dto/upsert-onboarding.dto';
import { coursesForProfile, type GoalSlug, type Level } from './goals';

export interface OnboardingProfileView {
  goals: string[];
  level: string;
  weekly_hours: string;
  known_languages: string[];
  completed_at: string;
}

@Injectable()
export class OnboardingService {
  private readonly log = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<OnboardingProfileView | null> {
    const row = await this.prisma.onboardingProfile.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      goals: (row.goals as unknown as string[]) ?? [],
      level: row.level,
      weekly_hours: row.weeklyHours,
      known_languages: (row.knownLanguages as unknown as string[]) ?? [],
      completed_at: row.completedAt.toISOString(),
    };
  }

  async upsert(userId: string, dto: UpsertOnboardingDto): Promise<OnboardingProfileView> {
    const row = await this.prisma.onboardingProfile.upsert({
      where: { userId },
      create: {
        userId,
        goals: dto.goals as unknown as object[],
        level: dto.level,
        weeklyHours: dto.weekly_hours,
        knownLanguages: (dto.known_languages ?? []) as unknown as object[],
      },
      update: {
        goals: dto.goals as unknown as object[],
        level: dto.level,
        weeklyHours: dto.weekly_hours,
        knownLanguages: (dto.known_languages ?? []) as unknown as object[],
        completedAt: new Date(),
      },
    });
    this.log.log(`onboarding upsert user=${userId} goals=${dto.goals.join(',')} level=${dto.level}`);
    return {
      goals: (row.goals as unknown as string[]) ?? [],
      level: row.level,
      weekly_hours: row.weeklyHours,
      known_languages: (row.knownLanguages as unknown as string[]) ?? [],
      completed_at: row.completedAt.toISOString(),
    };
  }

  /**
   * Produces the ranked list of course slugs this user's declared goals +
   * level map to. Used by the recommendation cascade as the fallback when
   * the student has no mastery rows yet.
   */
  coursesForProfile(profile: OnboardingProfileView): string[] {
    return coursesForProfile(profile.goals as GoalSlug[], profile.level as Level);
  }
}
