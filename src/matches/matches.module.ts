import { Module } from '@nestjs/common';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { MatchingAlgorithmService } from './matching-algorithm.service';
import { MatchingSchedulerService } from './matching-scheduler.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { NotificationsService } from '../common/services/notifications.service';

@Module({
  imports: [SupabaseModule],
  controllers: [MatchesController],
  providers: [
    MatchesService,
    MatchingAlgorithmService,
    MatchingSchedulerService,
    NotificationsService,
  ],
  exports: [MatchesService, MatchingAlgorithmService],
})
export class MatchesModule {}
