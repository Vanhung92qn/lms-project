import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { GOAL_SLUGS, LEVELS, WEEKLY_HOURS } from '../goals';

export class UpsertOnboardingDto {
  @ApiProperty({
    example: ['cpp-foundation', 'algorithms'],
    description: '1–3 goal slugs from the fixed vocabulary',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(GOAL_SLUGS, { each: true })
  goals!: string[];

  @ApiProperty({ enum: LEVELS })
  @IsIn(LEVELS)
  level!: string;

  @ApiProperty({ enum: WEEKLY_HOURS })
  @IsIn(WEEKLY_HOURS)
  weekly_hours!: string;

  @ApiProperty({
    example: ['C++', 'Python'],
    description: 'Free-text list of languages the student already knows',
    required: false,
  })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  known_languages: string[] = [];
}
