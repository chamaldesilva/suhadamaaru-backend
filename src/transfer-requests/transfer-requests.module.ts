import { Module } from '@nestjs/common';
import { TransferRequestsController } from './transfer-requests.controller';
import { TransferRequestsService } from './transfer-requests.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { PurchasesModule } from '../purchases/purchases.module';

@Module({
  imports: [SupabaseModule, PurchasesModule],
  controllers: [TransferRequestsController],
  providers: [TransferRequestsService],
  exports: [TransferRequestsService],
})
export class TransferRequestsModule {}
