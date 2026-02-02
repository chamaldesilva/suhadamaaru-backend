import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/chat.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/user.decorator';

interface JwtPayload {
  userId: string;
  email: string;
}

@Controller('api/matches/:matchId/messages')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  /**
   * Get messages for a match (paginated)
   * GET /api/matches/:matchId/messages?limit=50&offset=0
   */
  @Get()
  async getMessages(
    @Param('matchId') matchId: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.getMessages(
      matchId,
      user.userId,
      parseInt(limit) || 50,
      parseInt(offset) || 0,
    );
  }

  /**
   * Send a message in a match chat
   * POST /api/matches/:matchId/messages
   */
  @Post()
  async sendMessage(
    @Param('matchId') matchId: string,
    @Body() body: SendMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.sendMessage(matchId, user.userId, body.message);
  }

  /**
   * Mark a specific message as read
   * PATCH /api/matches/:matchId/messages/:messageId/read
   */
  @Patch(':messageId/read')
  async markAsRead(
    @Param('matchId') matchId: string,
    @Param('messageId') messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.chatService.markAsRead(matchId, messageId, user.userId);
    return { success: true };
  }

  /**
   * Mark all messages in a match as read
   * PATCH /api/matches/:matchId/messages/read-all
   */
  @Patch('read-all')
  async markAllAsRead(
    @Param('matchId') matchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.chatService.markAllAsRead(matchId, user.userId);
    return { success: true };
  }

  /**
   * Get unread message count for a match
   * GET /api/matches/:matchId/messages/unread-count
   */
  @Get('unread-count')
  async getUnreadCount(
    @Param('matchId') matchId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const count = await this.chatService.getUnreadCount(matchId, user.userId);
    return { count };
  }
}

/**
 * Separate controller for global chat operations
 */
@Controller('api/chat')
@UseGuards(JwtAuthGuard)
export class ChatGlobalController {
  constructor(private chatService: ChatService) {}

  /**
   * Get total unread message count across all accepted matches
   * GET /api/chat/unread-count
   */
  @Get('unread-count')
  async getTotalUnreadCount(@CurrentUser() user: JwtPayload) {
    const count = await this.chatService.getTotalUnreadCount(user.userId);
    return { count };
  }
}
