import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { ValidateReceiptDto } from './dto/validate-receipt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type JwtPayload,
} from '../common/decorators/user.decorator';

@Controller('api/purchases')
@UseGuards(JwtAuthGuard)
export class PurchasesController {
  constructor(private purchasesService: PurchasesService) {}

  @Post('validate-receipt')
  async validateReceipt(
    @Body() dto: ValidateReceiptDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.purchasesService.validateAndStoreReceipt(user.userId, dto);
  }

  @Get('credits')
  async getAvailableCredits(@CurrentUser() user: JwtPayload) {
    const credits = await this.purchasesService.getAvailableCredits(
      user.userId,
    );
    return { credits };
  }

  @Get('history')
  async getPurchaseHistory(@CurrentUser() user: JwtPayload) {
    return this.purchasesService.getPurchaseHistory(user.userId);
  }
}
