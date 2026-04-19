import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCourseDto {
  @ApiProperty({ example: 'cpp-from-zero' })
  @IsString()
  @Length(3, 80)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug must be kebab-case (lowercase + digits + hyphens)',
  })
  slug!: string;

  @ApiProperty({ example: 'C++ từ căn bản đến nâng cao' })
  @IsString()
  @Length(3, 140)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiProperty({ example: 'vi', required: false })
  @IsOptional()
  @IsIn(['vi', 'en'])
  locale?: 'vi' | 'en';

  @ApiProperty({ example: 'free', required: false, enum: ['free', 'paid'] })
  @IsOptional()
  @IsIn(['free', 'paid'])
  pricing_model?: 'free' | 'paid';

  @ApiProperty({ required: false, example: 49000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  price_cents?: number;

  @ApiProperty({ required: false, example: 'VND' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  cover_url?: string;
}
