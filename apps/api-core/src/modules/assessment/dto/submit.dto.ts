import { IsString, IsUUID, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitDto {
  @ApiProperty({ example: 'a0c861b1-1710-...' })
  @IsUUID()
  exercise_id!: string;

  @ApiProperty({ example: '#include <iostream>...' })
  @IsString()
  @Length(1, 64 * 1024)
  source_code!: string;
}
