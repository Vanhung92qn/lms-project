import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'student@khohoc.online' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Student@12345' })
  @IsString()
  @MinLength(1)
  password!: string;
}
