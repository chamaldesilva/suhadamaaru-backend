import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TransferRequestsService } from './transfer-requests.service';
import {
  CreateTransferRequestDto,
  UpdateTransferRequestDto,
} from './dto/transfer-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type JwtPayload,
} from '../common/decorators/user.decorator';

@Controller('api/transfer-requests')
@UseGuards(JwtAuthGuard)
export class TransferRequestsController {
  constructor(private transferRequestsService: TransferRequestsService) {}

  @Post()
  async createRequest(
    @Body() createDto: CreateTransferRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transferRequestsService.createRequest(user.userId, createDto);
  }

  @Get()
  async listRequests(@Query() query: any, @CurrentUser() user: JwtPayload) {
    const { limit = 50, offset = 0, ...filters } = query;
    const sort = {
      sortField: query.sortField,
      sortOrder: query.sortOrder,
    };
    return this.transferRequestsService.listRequests(
      user.userId,
      filters,
      sort,
      parseInt(limit),
      parseInt(offset),
    );
  }

  @Get('count/active')
  async getActiveRequestsCount(@CurrentUser() user: JwtPayload) {
    return this.transferRequestsService.getActiveRequestsCount(user.userId);
  }

  @Get('count/drafts')
  async getDraftRequestsCount(@CurrentUser() user: JwtPayload) {
    return this.transferRequestsService.getDraftRequestsCount(user.userId);
  }

  @Get('active')
  async getActiveRequest(@CurrentUser() user: JwtPayload) {
    return this.transferRequestsService.getActiveRequest(user.userId);
  }

  @Get(':requestId')
  async getRequestById(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transferRequestsService.getRequestById(requestId, user.userId);
  }

  @Get(':requestId/preferred-schools')
  async getPreferredSchools(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Verify user owns this request first
    await this.transferRequestsService.getRequestById(requestId, user.userId);
    return this.transferRequestsService.getPreferredSchools(requestId);
  }

  @Patch(':requestId')
  async updateRequest(
    @Param('requestId') requestId: string,
    @Body() updateDto: UpdateTransferRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transferRequestsService.updateRequest(
      requestId,
      user.userId,
      updateDto,
    );
  }

  @Post(':requestId/submit')
  async submitRequest(
    @Param('requestId') requestId: string,
    @Body() body: { purchaseId?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transferRequestsService.submitRequest(
      requestId,
      user.userId,
      body.purchaseId,
    );
  }

  @Post(':requestId/withdraw')
  async withdrawRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.transferRequestsService.withdrawRequest(requestId, user.userId);
  }

  @Delete(':requestId')
  async deleteRequest(
    @Param('requestId') requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.transferRequestsService.deleteRequest(requestId, user.userId);
    return { message: 'Transfer request deleted successfully' };
  }
}
