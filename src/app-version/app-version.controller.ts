import { Controller, Get, Query } from '@nestjs/common';
import { AppVersionService } from './app-version.service';

@Controller('app-version')
export class AppVersionController {
  constructor(private readonly appVersionService: AppVersionService) {}

  @Get('check')
  checkVersion(
    @Query('platform') platform: 'ios' | 'android',
    @Query('currentVersion') currentVersion: string,
  ) {
    return this.appVersionService.checkVersion(platform, currentVersion);
  }

  @Get('latest')
  async getLatestVersion(@Query('platform') platform: 'ios' | 'android') {
    return this.appVersionService.getLatestVersion(platform);
  }
}
