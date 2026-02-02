import { Module } from '@nestjs/common';
import { TransferRequestsController } from './transfer-requests.controller';
import { TransferRequestsService } from './transfer-requests.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [TransferRequestsController],
  providers: [TransferRequestsService],
  exports: [TransferRequestsService],
})
export class TransferRequestsModule {}
