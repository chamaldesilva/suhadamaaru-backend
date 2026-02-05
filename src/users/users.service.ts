import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { UpdateUserProfileDto } from './dto/update-profile.dto';
import { UploadProfileImageDto } from './dto/upload-profile-image.dto';

// Profile image settings
const PROFILE_IMAGE_SIZE = 400; // 400x400 pixels
const PROFILE_IMAGE_QUALITY = 80; // JPEG quality (0-100)

@Injectable()
export class UsersService {
  constructor(@Inject('SUPABASE_CLIENT') private supabase: SupabaseClient) {}

  /**
   * Upload a profile image to Supabase Storage
   * Compresses and resizes the image before uploading
   * Returns the public URL of the uploaded image
   */
  async uploadProfileImage(
    userId: string,
    uploadDto: UploadProfileImageDto,
  ): Promise<string> {
    const { base64Data } = uploadDto;

    // Always save as JPEG for consistent format and better compression
    const fileName = `${userId}/profile.jpg`;
    const contentType = 'image/jpeg';

    // Decode base64 to Buffer
    const inputBuffer = Buffer.from(base64Data, 'base64');

    // Compress and resize image using sharp
    const compressedBuffer = await sharp(inputBuffer)
      .resize(PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: PROFILE_IMAGE_QUALITY })
      .toBuffer();

    // Upload to Supabase Storage
    const { error: uploadError } = await this.supabase.storage
      .from('profile-images')
      .upload(fileName, compressedBuffer, {
        upsert: true,
        contentType,
      });

    if (uploadError) {
      throw new BadRequestException(
        uploadError.message || 'Failed to upload image',
      );
    }

    // Get public URL with cache-busting timestamp
    const {
      data: { publicUrl },
    } = this.supabase.storage.from('profile-images').getPublicUrl(fileName);

    // Add cache-busting query parameter to force refresh
    const urlWithCacheBuster = `${publicUrl}?v=${Date.now()}`;

    // Update user profile with the new image URL
    await this.updateUserProfile(userId, {
      profile_image_url: urlWithCacheBuster,
    });

    return urlWithCacheBuster;
  }

  /**
   * Delete a profile image from Supabase Storage
   */
  async deleteProfileImage(userId: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from('profile-images')
      .remove([`${userId}/profile.jpg`, `${userId}/profile.png`]);

    if (error) {
      throw new BadRequestException(error.message || 'Failed to delete image');
    }

    // Clear the profile image URL in the database
    await this.updateUserProfile(userId, { profile_image_url: '' });
  }

  async getUserProfile(userId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    return data;
  }

  /**
   * Get basic user info for chat display
   * Respects profile_visible setting - hides profile_image_url if false
   */
  async getUserBasicInfo(userId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, first_name, last_name, profile_image_url, profile_visible')
      .eq('id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    // Hide profile image if profile_visible is false
    return {
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      profile_image_url:
        data.profile_visible === false ? null : data.profile_image_url,
      profile_visible: data.profile_visible,
    };
  }

  async updateUserProfile(
    userId: string,
    updateProfileDto: UpdateUserProfileDto,
  ) {
    const updateData = {
      ...updateProfileDto,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        throw new BadRequestException(
          'This NIC is already registered with another account',
        );
      }
      throw new BadRequestException(error.message);
    }

    return data;
  }
}
