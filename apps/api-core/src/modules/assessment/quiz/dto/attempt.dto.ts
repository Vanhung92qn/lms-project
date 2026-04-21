import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class QuizAnswerDto {
  @ApiProperty({ example: 'q1' })
  @IsString()
  @MaxLength(16)
  question_id!: string;

  @ApiProperty({ example: 0, minimum: 0, maximum: 3 })
  @IsInt()
  @Min(0)
  @Max(3)
  selected_index!: number;
}

export class QuizAttemptDto {
  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}
