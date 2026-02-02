import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export type NotificationType =
  | 'match_created'
  | 'match_accepted'
  | 'match_rejected'
  | 'match_expired'
  | 'request_status_changed';

export interface CreateNotificationDto {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject('SUPABASE_CLIENT') private supabase: SupabaseClient) {}

  /**
   * Create a notification for a user
   */
  async createNotification(dto: CreateNotificationDto): Promise<any> {
    try {
      const { data, error } = await this.supabase
        .from('notifications')
        .insert({
          user_id: dto.userId,
          type: dto.type,
          title: dto.title,
          body: dto.body,
          related_entity_type: dto.relatedEntityType,
          related_entity_id: dto.relatedEntityId,
          is_read: false,
        })
        .select()
        .single();

      if (error) {
        this.logger.error('Error creating notification:', error);
        throw new Error(error.message);
      }

      this.logger.log(
        `Notification created for user ${dto.userId}: ${dto.title}`,
      );
      return data;
    } catch (error) {
      this.logger.error('Exception in createNotification:', error);
      throw error;
    }
  }

  /**
   * Create notifications for multiple users
   */
  async createBulkNotifications(
    notifications: CreateNotificationDto[],
  ): Promise<any[]> {
    try {
      const notificationData = notifications.map((dto) => ({
        user_id: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        related_entity_type: dto.relatedEntityType,
        related_entity_id: dto.relatedEntityId,
        is_read: false,
      }));

      const { data, error } = await this.supabase
        .from('notifications')
        .insert(notificationData)
        .select();

      if (error) {
        this.logger.error('Error creating bulk notifications:', error);
        throw new Error(error.message);
      }

      this.logger.log(`Created ${data?.length || 0} notifications`);
      return data || [];
    } catch (error) {
      this.logger.error('Exception in createBulkNotifications:', error);
      throw error;
    }
  }

  /**
   * Notify users about a new match
   */
  async notifyMatchCreated(
    matchId: string,
    participants: Array<{ userId: string; userName: string }>,
  ): Promise<void> {
    try {
      const notifications: CreateNotificationDto[] = participants.map(
        (participant) => {
          const otherParticipants = participants
            .filter((p) => p.userId !== participant.userId)
            .map((p) => p.userName)
            .join(', ');

          return {
            userId: participant.userId,
            type: 'match_created',
            title: 'New Transfer Match Found!',
            body: `A compatible transfer match has been found with ${otherParticipants}. Review and respond to this match.`,
            relatedEntityType: 'match',
            relatedEntityId: matchId,
          };
        },
      );

      await this.createBulkNotifications(notifications);

      // TODO: Send push notifications and emails here
      // await this.sendPushNotifications(participants, matchId);
      // await this.sendEmailNotifications(participants, matchId);
    } catch (error) {
      this.logger.error('Error notifying match created:', error);
      // Don't throw - notifications are not critical
    }
  }

  /**
   * Notify users when a match is accepted
   */
  async notifyMatchAccepted(
    matchId: string,
    acceptedByUserId: string,
    acceptedByUserName: string,
    otherParticipants: Array<{ userId: string }>,
  ): Promise<void> {
    try {
      const notifications: CreateNotificationDto[] = otherParticipants.map(
        (participant) => ({
          userId: participant.userId,
          type: 'match_accepted',
          title: 'Match Participant Responded',
          body: `${acceptedByUserName} has accepted the transfer match. Check the match details.`,
          relatedEntityType: 'match',
          relatedEntityId: matchId,
        }),
      );

      await this.createBulkNotifications(notifications);
    } catch (error) {
      this.logger.error('Error notifying match accepted:', error);
    }
  }

  /**
   * Notify users when a match is rejected
   */
  async notifyMatchRejected(
    matchId: string,
    rejectedByUserName: string,
    participants: Array<{ userId: string }>,
  ): Promise<void> {
    try {
      const notifications: CreateNotificationDto[] = participants.map(
        (participant) => ({
          userId: participant.userId,
          type: 'match_rejected',
          title: 'Match Rejected',
          body: `${rejectedByUserName} has rejected the transfer match. The match has been closed.`,
          relatedEntityType: 'match',
          relatedEntityId: matchId,
        }),
      );

      await this.createBulkNotifications(notifications);
    } catch (error) {
      this.logger.error('Error notifying match rejected:', error);
    }
  }

  /**
   * Get user's unread notification count
   */
  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      this.logger.error('Error getting unread count:', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error('Error marking notification as read:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      this.logger.error('Error marking all notifications as read:', error);
      throw new Error(error.message);
    }
  }
}
