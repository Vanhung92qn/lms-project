import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateCourseDto } from './create-course.dto';

// Everything on create is optional for update, EXCEPT slug which is
// deliberately disallowed post-creation to keep URLs stable.
export class UpdateCourseDto extends PartialType(CreateCourseDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  declare title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  declare description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsIn(['free', 'paid'])
  declare pricing_model?: 'free' | 'paid';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  declare price_cents?: number;

  // Slug is intentionally read-only after creation to keep links stable.
  // PartialType gives us an optional slug on the type; the service ignores it.
}

export class CreateModuleDto {
  @ApiProperty({ example: 'Khởi động' })
  @IsString()
  @Length(2, 120)
  title!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  sort_order!: number;
}

export class CreateLessonDto {
  @ApiProperty({ example: 'Hello, world!' })
  @IsString()
  @Length(2, 160)
  title!: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  sort_order!: number;

  @ApiProperty({ enum: ['markdown', 'exercise', 'quiz'] })
  @IsIn(['markdown', 'exercise', 'quiz'])
  type!: 'markdown' | 'exercise' | 'quiz';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  content_markdown?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  est_minutes?: number;
}

// Module edit DTO — title + sort_order optional. Backend ignores any
// field not provided (partial update).
export class UpdateModuleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  sort_order?: number;
}

// Lesson edit DTO — every authoring-relevant field optional. `type` stays
// here so admins can fix a lesson that was created with the wrong type.
export class UpdateLessonDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  sort_order?: number;

  @ApiProperty({ required: false, enum: ['markdown', 'exercise', 'quiz'] })
  @IsOptional()
  @IsIn(['markdown', 'exercise', 'quiz'])
  type?: 'markdown' | 'exercise' | 'quiz';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 64 * 1024)
  content_markdown?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  est_minutes?: number;
}
