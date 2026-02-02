import { Module } from '@nestjs/common';
import { ChatController, ChatGlobalController } from './chat.controller';
import { ChatService } from './chat.service';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ChatController, ChatGlobalController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
