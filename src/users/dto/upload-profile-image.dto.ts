import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class UploadProfileImageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10485760, { message: 'Image size exceeds 10MB limit' }) // ~10MB base64
  base64Data: string;

  @IsString()
  @IsOptional()
  fileExt?: string;
}
