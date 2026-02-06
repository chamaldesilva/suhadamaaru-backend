import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { ValidateReceiptDto } from './dto/validate-receipt.dto';

const APPLE_PRODUCTION_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';
const VALID_PRODUCT_ID = 'com.chamzo.suhadamaaru.submit_request';

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private supabase: SupabaseClient,
    private configService: ConfigService,
  ) {}

  /**
   * Validate an Apple receipt and store the purchase
   */
  async validateAndStoreReceipt(userId: string, dto: ValidateReceiptDto) {
    // Check for duplicate transaction (idempotent)
    const { data: existing } = await this.supabase
      .from('purchases')
      .select('id, status')
      .eq('apple_transaction_id', dto.transactionId)
      .single();

    if (existing) {
      return existing;
    }

    // Validate product ID
    if (dto.productId !== VALID_PRODUCT_ID) {
      throw new BadRequestException('Invalid product ID');
    }

    // Validate receipt with Apple
    const appleResponse = await this.verifyWithApple(dto.receiptData);

    if (!appleResponse.valid) {
      // Store as failed for audit
      await this.supabase.from('purchases').insert({
        user_id: userId,
        apple_transaction_id: dto.transactionId,
        apple_product_id: dto.productId,
        receipt_data: dto.receiptData,
        status: 'failed',
      });
      throw new BadRequestException('Receipt validation failed');
    }

    // Verify the transaction exists in the receipt
    const transaction = appleResponse.inApp?.find(
      (t: any) => t.transaction_id === dto.transactionId,
    );

    if (!transaction) {
      throw new BadRequestException(
        'Transaction not found in receipt',
      );
    }

    // Verify product ID in the receipt matches
    if (transaction.product_id !== VALID_PRODUCT_ID) {
      throw new BadRequestException(
        'Product ID mismatch in receipt',
      );
    }

    // Store validated purchase
    const { data: purchase, error } = await this.supabase
      .from('purchases')
      .insert({
        user_id: userId,
        apple_transaction_id: dto.transactionId,
        apple_product_id: dto.productId,
        receipt_data: dto.receiptData,
        status: 'validated',
        purchased_at: new Date(
          parseInt(transaction.purchase_date_ms),
        ).toISOString(),
        validated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Error storing purchase:', error);
      throw new Error('Failed to store purchase');
    }

    return purchase;
  }

  /**
   * Verify receipt with Apple's servers
   */
  private async verifyWithApple(
    receiptData: string,
  ): Promise<{ valid: boolean; inApp?: any[] }> {
    const sharedSecret =
      this.configService.get<string>('APPLE_SHARED_SECRET') || '';

    const payload = {
      'receipt-data': receiptData,
      password: sharedSecret,
      'exclude-old-transactions': true,
    };

    try {
      // Try production first
      let response = await fetch(APPLE_PRODUCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let result = await response.json();

      // Status 21007 means it's a sandbox receipt
      if (result.status === 21007) {
        response = await fetch(APPLE_SANDBOX_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        result = await response.json();
      }

      if (result.status === 0) {
        return {
          valid: true,
          inApp: result.receipt?.in_app || [],
        };
      }

      this.logger.warn(`Apple receipt validation failed with status: ${result.status}`);
      return { valid: false };
    } catch (error) {
      this.logger.error('Error verifying with Apple:', error);
      return { valid: false };
    }
  }

  /**
   * Consume a validated purchase for a transfer request submission
   */
  async consumePurchase(userId: string, transferRequestId: string) {
    // Find the oldest validated (unconsumed) purchase for this user
    const { data: purchase, error: findError } = await this.supabase
      .from('purchases')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'validated')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (findError || !purchase) {
      throw new BadRequestException(
        'No available purchase credits. Please purchase a submission first.',
      );
    }

    // Mark as consumed
    const { data: updated, error: updateError } = await this.supabase
      .from('purchases')
      .update({
        status: 'consumed',
        transfer_request_id: transferRequestId,
        consumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', purchase.id)
      .eq('status', 'validated')
      .select()
      .single();

    if (updateError || !updated) {
      throw new Error('Failed to consume purchase');
    }

    return updated;
  }

  /**
   * Rollback a consumed purchase (if submission fails)
   */
  async rollbackConsumption(purchaseId: string) {
    await this.supabase
      .from('purchases')
      .update({
        status: 'validated',
        transfer_request_id: null,
        consumed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', purchaseId)
      .eq('status', 'consumed');
  }

  /**
   * Get available credits (validated but unconsumed purchases)
   */
  async getAvailableCredits(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('purchases')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'validated');

    if (error) throw new Error(error.message);

    return count || 0;
  }

  /**
   * Get purchase history for a user
   */
  async getPurchaseHistory(userId: string) {
    const { data, error } = await this.supabase
      .from('purchases')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    return data || [];
  }
}
