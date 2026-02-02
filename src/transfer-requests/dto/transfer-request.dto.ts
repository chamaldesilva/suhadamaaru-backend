import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
} from 'class-validator';

export class CreateTransferRequestDto {
  @IsOptional()
  @IsString()
  transfer_reason?: string;

  @IsEnum(['normal', 'high'])
  urgency_level: string;

  @IsEnum(['district_only', 'province_wide', 'nationwide'])
  geographic_flexibility: string;

  @IsBoolean()
  willing_temporary_transfer: boolean;

  @IsOptional()
  @IsString()
  additional_notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferred_school_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subject_ids?: string[];
}

export class UpdateTransferRequestDto {
  @IsOptional()
  @IsString()
  transfer_reason?: string;

  @IsOptional()
  @IsEnum(['normal', 'high'])
  urgency_level?: string;

  @IsOptional()
  @IsEnum(['district_only', 'province_wide', 'nationwide'])
  geographic_flexibility?: string;

  @IsOptional()
  @IsBoolean()
  willing_temporary_transfer?: boolean;

  @IsOptional()
  @IsString()
  additional_notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferred_school_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subject_ids?: string[];

  @IsOptional()
  @IsEnum(['draft', 'withdrawn'])
  status?: string;
}
