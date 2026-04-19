import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt.guard';
import { OAuthController } from './auth/oauth.controller';
import { OAuthService } from './auth/oauth.service';
import { UsersController } from './users/users.controller';
import { RbacService } from './rbac/rbac.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('app.jwt.accessSecret'),
        signOptions: { expiresIn: config.get<string>('app.jwt.accessTtl') ?? '15m' },
      }),
    }),
  ],
  controllers: [AuthController, OAuthController, UsersController],
  providers: [AuthService, OAuthService, JwtAuthGuard, RbacService],
  exports: [JwtAuthGuard, RbacService, AuthService],
})
export class IamModule {}
