import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignInDto, VerifyOtpDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Strict rate limit: 5 requests per minute to prevent OTP spam
  @Post('sign-in')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async signIn(@Body() signInDto: SignInDto) {
    return this.authService.signIn(signInDto);
  }

  // Strict rate limit: 10 requests per minute to prevent brute force
  @Post('verify-otp')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sign-out')
  async signOut(@CurrentUser() user: any) {
    return this.authService.signOut(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('session')
  async getSession(@CurrentUser() user: any) {
    return this.authService.getSession(user.userId);
  }
}
