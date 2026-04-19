import { IsIn, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ required: false, example: 'Nguyễn Văn Hùng' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  display_name?: string;

  @ApiProperty({ required: false, enum: ['vi', 'en'] })
  @IsOptional()
  @IsIn(['vi', 'en'])
  locale?: 'vi' | 'en';

  @ApiProperty({
    required: false,
    description: 'Public URL to an avatar image (e.g. Gravatar). Empty string clears.',
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  // Accept empty string as a clearing signal; only validate as URL when non-empty.
  // class-validator's IsUrl would reject '' so we handle that in the service.
  avatar_url?: string;
}
