import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SignInDto, VerifyOtpDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject('SUPABASE_CLIENT') private supabase: SupabaseClient,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async signIn(signInDto: SignInDto) {
    const { email } = signInDto;

    const { error } = await this.supabase.auth.signInWithOtp({
      email: email.toLowerCase().trim(),
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    return {
      message: 'SignIn OTP sent successfully',
    };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const { email, token } = verifyOtpDto;

    const { data, error } = await this.supabase.auth.verifyOtp({
      email: email.toLowerCase().trim(),
      token: token.trim(),
      type: 'email',
    });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    if (!data.user) {
      throw new UnauthorizedException('Invalid OTP');
    }

    // Ensure user profile exists
    await this.ensureUserProfile(data.user.id, data.user.email!);

    // Generate JWT token
    const accessToken = this.generateToken(data.user.id, data.user.email!);

    // Get user profile
    const { data: userProfile } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    return {
      accessToken,
      user: userProfile,
      session: data.session,
    };
  }

  async signOut(userId: string) {
    // Optionally invalidate sessions on Supabase
    await this.supabase.auth.admin.signOut(userId);
    return { message: 'Signed out successfully' };
  }

  async getSession(userId: string) {
    const { data: userProfile } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    return {
      session: {
        user: userProfile,
      },
    };
  }

  private generateToken(userId: string, email: string): string {
    const payload = { sub: userId, email };
    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRATION') || '7d',
    });
  }

  private async ensureUserProfile(userId: string, email: string) {
    const { data: existingUser } = await this.supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existingUser) {
      await this.supabase.from('users').insert({
        id: userId,
        email: email,
        role: 'teacher',
        is_verified: true,
        profile_completed: false,
        is_active: true,
        last_login_at: new Date().toISOString(),
      });
    } else {
      await this.supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', userId);
    }
  }
}
