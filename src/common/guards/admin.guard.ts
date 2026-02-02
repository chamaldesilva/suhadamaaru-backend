import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Guard to check if user has admin role from database
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject('SUPABASE_CLIENT') private supabase: SupabaseClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Check user role from database
    const { data: dbUser, error } = await this.supabase
      .from('users')
      .select('role')
      .eq('id', user.userId)
      .single();

    if (error || !dbUser) {
      throw new ForbiddenException('Unable to verify user role');
    }

    if (dbUser.role !== 'admin') {
      throw new ForbiddenException('Access denied. Admin privileges required.');
    }

    return true;
  }
}
