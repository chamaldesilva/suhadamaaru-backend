import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserProfileDto } from './dto/update-profile.dto';
import { UploadProfileImageDto } from './dto/upload-profile-image.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

@Controller('api/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get(':userId/profile')
  async getUserProfile(
    @Param('userId') userId: string,
    @CurrentUser() user: any,
  ) {
    // Ensure user can only access their own profile
    if (userId !== user.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    return this.usersService.getUserProfile(userId);
  }

  @Patch(':userId/profile')
  async updateUserProfile(
    @Param('userId') userId: string,
    @Body() updateProfileDto: UpdateUserProfileDto,
    @CurrentUser() user: any,
  ) {
    // Ensure user can only update their own profile
    if (userId !== user.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    return this.usersService.updateUserProfile(userId, updateProfileDto);
  }

  @Post(':userId/profile-image')
  async uploadProfileImage(
    @Param('userId') userId: string,
    @Body() uploadDto: UploadProfileImageDto,
    @CurrentUser() user: any,
  ) {
    // Ensure user can only upload their own profile image
    if (userId !== user.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    const publicUrl = await this.usersService.uploadProfileImage(
      userId,
      uploadDto,
    );
    return { profile_image_url: publicUrl };
  }

  @Delete(':userId/profile-image')
  async deleteProfileImage(
    @Param('userId') userId: string,
    @CurrentUser() user: any,
  ) {
    // Ensure user can only delete their own profile image
    if (userId !== user.userId) {
      throw new ForbiddenException('Unauthorized');
    }
    await this.usersService.deleteProfileImage(userId);
    return { message: 'Profile image deleted successfully' };
  }
}
