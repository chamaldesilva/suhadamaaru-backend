import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MatchingAlgorithmService } from './matching-algorithm.service';

@Injectable()
export class MatchingSchedulerService {
  private readonly logger = new Logger(MatchingSchedulerService.name);

  constructor(private matchingAlgorithmService: MatchingAlgorithmService) {}

  /**
   * Run matching algorithm daily at 2 AM - 0 2 * * *
   * Every minute for testing: * * * * *
   */
  @Cron('0 2 * * *', {
    name: 'daily-matching',
    timeZone: 'Asia/Colombo',
  })
  async runDailyMatching() {
    this.logger.log('Starting scheduled matching algorithm at 2 AM...');

    try {
      // Run the matching algorithm
      const result = await this.matchingAlgorithmService.runMatchingAlgorithm();

      this.logger.log(
        `Scheduled matching completed: ${result.matchesCreated} matches created, ${result.requestsProcessed} requests processed`,
      );

      // Expire old matches
      const expiredCount =
        await this.matchingAlgorithmService.expireOldMatches();

      if (expiredCount > 0) {
        this.logger.log(`Expired ${expiredCount} old matches`);
      }
    } catch (error) {
      this.logger.error('Error in scheduled matching:', error);
    }
  }

  /**
   * Expire old matches every hour
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'expire-matches',
    timeZone: 'Asia/Colombo',
  })
  async expireOldMatchesHourly() {
    try {
      const expiredCount =
        await this.matchingAlgorithmService.expireOldMatches();

      if (expiredCount > 0) {
        this.logger.log(`Hourly expiration: ${expiredCount} matches expired`);
      }
    } catch (error) {
      this.logger.error('Error in hourly match expiration:', error);
    }
  }
}
