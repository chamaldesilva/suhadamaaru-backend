import { IsString, IsNotEmpty } from 'class-validator';

export class ValidateReceiptDto {
  @IsString()
  @IsNotEmpty()
  receiptData: string;

  @IsString()
  @IsNotEmpty()
  transactionId: string;

  @IsString()
  @IsNotEmpty()
  productId: string;
}
