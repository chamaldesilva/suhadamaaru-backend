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
    const normalizedEmail = email.toLowerCase().trim();

    // Special handling for Apple Review test account
    const testEmail = this.configService.get('APPLE_REVIEW_TEST_EMAIL');
    if (testEmail && normalizedEmail === testEmail.toLowerCase()) {
      // For test account, we don't send real OTP
      // The fixed OTP will be verified in verifyOtp method below
      return {
        message: 'SignIn OTP sent successfully',
      };
    }

    const { error } = await this.supabase.auth.signInWithOtp({
      email: normalizedEmail,
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
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedToken = token.trim();

    // Special handling for Apple Review test account
    const testEmail = this.configService.get('APPLE_REVIEW_TEST_EMAIL');
    const testOtp = this.configService.get('APPLE_REVIEW_TEST_OTP');

    if (testEmail && testOtp && normalizedEmail === testEmail.toLowerCase()) {
      // Verify the fixed OTP for test account
      if (normalizedToken !== testOtp) {
        throw new UnauthorizedException('Invalid OTP');
      }

      // Use a fixed UUID for test account
      const userId = '00000000-0000-0000-0000-000000000001';

      // Check if test user already exists
      const { data: existingUser } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (existingUser) {
        // Update last login
        await this.supabase
          .from('users')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', userId);
      } else {
        // Create new test user with sample data
        await this.supabase.from('users').insert({
          id: userId,
          email: normalizedEmail,
          nic: '123456789V',
          mobile: '0771234567',
          first_name: 'Apple',
          last_name: 'Reviewer',
          date_of_birth: '1990-01-01',
          gender: 'male',
          auth_provider: 'supabase',
          role: 'teacher',
          is_verified: true,
          profile_completed: true,
          is_active: true,
          last_login_at: new Date().toISOString(),
          current_grade: 'class_3_grade_2',
          medium_of_instruction: 'sinhala',
        });
      }

      // Generate JWT token
      const accessToken = this.generateToken(userId, normalizedEmail);

      // Get user profile
      const { data: userProfile } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      return {
        accessToken,
        user: userProfile,
        session: {
          access_token: accessToken,
          user: userProfile,
        },
      };
    }

    // Normal OTP verification flow
    const { data, error } = await this.supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedToken,
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
