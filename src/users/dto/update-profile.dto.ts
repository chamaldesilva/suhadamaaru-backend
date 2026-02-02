import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsDateString,
  IsEnum,
} from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  nic?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @IsOptional()
  @IsEnum(['male', 'female', 'other'])
  gender?: string;

  @IsOptional()
  @IsInt()
  current_school_id?: number;

  @IsOptional()
  @IsInt()
  appointment_category_id?: number;

  @IsOptional()
  @IsDateString()
  appointment_date?: string;

  @IsOptional()
  @IsEnum([
    'class_3_grade_2',
    'class_3_grade_1',
    'class_2_grade_2',
    'class_2_grade_1',
    'class_1',
  ])
  current_grade?: string;

  @IsOptional()
  @IsEnum(['sinhala', 'tamil', 'english'])
  medium_of_instruction?: string;

  @IsOptional()
  @IsBoolean()
  service_bond_completed?: boolean;

  @IsOptional()
  @IsInt()
  service_bond_remaining_years?: number;

  @IsOptional()
  @IsString()
  emergency_contact_name?: string;

  @IsOptional()
  @IsString()
  emergency_contact_mobile?: string;

  @IsOptional()
  @IsBoolean()
  profile_completed?: boolean;

  @IsOptional()
  @IsString()
  profile_image_url?: string;

  @IsOptional()
  @IsBoolean()
  profile_visible?: boolean;
}
