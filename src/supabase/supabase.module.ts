import { Module, Global } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  providers: [
    {
      provide: 'SUPABASE_CLIENT',
      useFactory: (configService: ConfigService) => {
        const supabaseUrl = configService.get('SUPABASE_URL');
        const supabaseServiceKey = configService.get('SUPABASE_SERVICE_KEY');

        if (!supabaseUrl || !supabaseServiceKey) {
          throw new Error('Supabase configuration is missing');
        }

        return createClient(supabaseUrl, supabaseServiceKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: ['SUPABASE_CLIENT'],
})
export class SupabaseModule {}
