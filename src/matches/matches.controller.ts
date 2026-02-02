import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchingAlgorithmService } from './matching-algorithm.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import {
  CurrentUser,
  type JwtPayload,
} from '../common/decorators/user.decorator';

@Controller('api/matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(
    private matchesService: MatchesService,
    private matchingAlgorithmService: MatchingAlgorithmService,
  ) {}

  @Get()
  async listMatches(@Query() query: any, @CurrentUser() user: JwtPayload) {
    const { limit = 50, offset = 0, ...filters } = query;
    const sort = {
      sortField: query.sortField,
      sortOrder: query.sortOrder,
    };
    return this.matchesService.listMatches(
      user.userId,
      filters,
      sort,
      parseInt(String(limit)),
      parseInt(String(offset)),
    );
  }

  @Get('count/pending')
  async getPendingMatchesCount(@CurrentUser() user: JwtPayload) {
    return this.matchesService.getPendingMatchesCount(user.userId);
  }

  @Get('count/accepted')
  async getAcceptedMatchesCount(@CurrentUser() user: JwtPayload) {
    return this.matchesService.getAcceptedMatchesCount(user.userId);
  }

  @Get('recent')
  async getRecentMatches(
    @Query('limit') limit: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matchesService.getRecentMatches(
      user.userId,
      parseInt(limit) || 5,
    );
  }

  @Get(':matchId')
  async getMatchDetails(
    @Param('matchId') matchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matchesService.getMatchDetails(matchId, user.userId);
  }

  @Get(':matchId/participants')
  async getParticipants(
    @Param('matchId') matchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matchesService.getParticipants(matchId, user.userId);
  }

  @Post(':matchId/accept')
  async acceptMatch(
    @Param('matchId') matchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matchesService.acceptMatch(matchId, user.userId);
  }

  @Post(':matchId/reject')
  async rejectMatch(
    @Param('matchId') matchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.matchesService.rejectMatch(matchId, user.userId);
  }

  @Post('run-algorithm')
  @UseGuards(AdminGuard)
  async runMatchingAlgorithm(@CurrentUser() _user: JwtPayload) {
    const result = await this.matchingAlgorithmService.runMatchingAlgorithm();
    return {
      message: 'Matching algorithm completed',
      ...result,
    };
  }

  @Post('expire-old')
  @UseGuards(AdminGuard)
  async expireOldMatches(@CurrentUser() _user: JwtPayload) {
    const expiredCount = await this.matchingAlgorithmService.expireOldMatches();
    return {
      message: 'Old matches expired',
      expiredCount,
    };
  }
}
