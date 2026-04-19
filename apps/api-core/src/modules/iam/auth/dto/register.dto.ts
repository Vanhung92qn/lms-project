import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'student@khohoc.online' })
  @IsEmail()
  @Length(3, 254)
  email!: string;

  @ApiProperty({ example: 'Student@12345', minLength: 10 })
  @IsString()
  @MinLength(10)
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/[0-9]/, { message: 'password must contain a digit' })
  password!: string;

  @ApiProperty({ example: 'Nguyễn Văn Hùng' })
  @IsString()
  @Length(2, 80)
  display_name!: string;

  @ApiProperty({ example: 'vi', enum: ['vi', 'en'], required: false })
  @IsOptional()
  @IsIn(['vi', 'en'])
  locale?: 'vi' | 'en';
}
