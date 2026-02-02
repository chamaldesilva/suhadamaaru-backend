import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

export interface ChatMessage {
  id: string;
  match_id: string;
  sender_id: string;
  message_text: string;
  is_read: boolean;
  created_at: string;
  updated_at?: string;
  sender?: {
    id: string;
    first_name?: string;
    last_name?: string;
    profile_image_url?: string;
    profile_visible?: boolean;
  };
}

@Injectable()
export class ChatService {
  constructor(@Inject('SUPABASE_CLIENT') private supabase: SupabaseClient) {}

  /**
   * Verify that a user is a participant in an accepted match
   */
  async verifyMatchAccess(matchId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('transfer_match_participants')
      .select(
        `
        id,
        transfer_matches!inner(status)
      `,
      )
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return false;
    }

    // Check if the match is accepted
    const matchData = data.transfer_matches as any;
    return matchData?.status === 'accepted';
  }

  /**
   * Get messages for a match with pagination
   */
  async getMessages(
    matchId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ data: ChatMessage[]; count: number }> {
    // Verify user has access to this match's chat
    const hasAccess = await this.verifyMatchAccess(matchId, userId);
    if (!hasAccess) {
      throw new ForbiddenException(
        'You do not have access to this chat. The match must be accepted.',
      );
    }

    const { data, error, count } = await this.supabase
      .from('match_messages')
      .select(
        `
        *,
        sender:users(id, first_name, last_name, profile_image_url, profile_visible)
      `,
        { count: 'exact' },
      )
      .eq('match_id', matchId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(error.message);
    }

    // Process sender visibility - hide profile_image_url if profile_visible is false
    const processedData = (data || []).map((message) => {
      if (message.sender && message.sender_id !== userId) {
        if (message.sender.profile_visible === false) {
          return {
            ...message,
            sender: {
              ...message.sender,
              profile_image_url: null,
            },
          };
        }
      }
      return message;
    });

    return { data: processedData, count: count || 0 };
  }

  /**
   * Send a message in a match chat
   */
  async sendMessage(
    matchId: string,
    userId: string,
    messageText: string,
  ): Promise<ChatMessage> {
    // Verify user has access to this match's chat
    const hasAccess = await this.verifyMatchAccess(matchId, userId);
    if (!hasAccess) {
      throw new ForbiddenException(
        'You do not have access to this chat. The match must be accepted.',
      );
    }

    const { data, error } = await this.supabase
      .from('match_messages')
      .insert({
        match_id: matchId,
        sender_id: userId,
        message_text: messageText,
        is_read: false,
      })
      .select(
        `
        *,
        sender:users(id, first_name, last_name, profile_image_url, profile_visible)
      `,
      )
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  /**
   * Mark a message as read
   */
  async markAsRead(
    matchId: string,
    messageId: string,
    userId: string,
  ): Promise<void> {
    // Verify user has access to this match's chat
    const hasAccess = await this.verifyMatchAccess(matchId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this chat.');
    }

    // Only mark messages from other users as read
    const { error } = await this.supabase
      .from('match_messages')
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('match_id', matchId)
      .neq('sender_id', userId);

    if (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Mark all messages in a match as read for a user
   */
  async markAllAsRead(matchId: string, userId: string): Promise<void> {
    // Verify user has access to this match's chat
    const hasAccess = await this.verifyMatchAccess(matchId, userId);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this chat.');
    }

    // Only mark messages from other users as read
    const { error } = await this.supabase
      .from('match_messages')
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq('match_id', matchId)
      .eq('is_read', false)
      .neq('sender_id', userId);

    if (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Get unread message count for a match
   */
  async getUnreadCount(matchId: string, userId: string): Promise<number> {
    // Verify user has access to this match's chat
    const hasAccess = await this.verifyMatchAccess(matchId, userId);
    if (!hasAccess) {
      return 0;
    }

    const { count, error } = await this.supabase
      .from('match_messages')
      .select('*', { count: 'exact', head: true })
      .eq('match_id', matchId)
      .eq('is_read', false)
      .neq('sender_id', userId);

    if (error) {
      throw new Error(error.message);
    }

    return count || 0;
  }

  /**
   * Get total unread count across all user's accepted matches
   */
  async getTotalUnreadCount(userId: string): Promise<number> {
    // First get all accepted matches for the user
    const { data: participantData, error: participantError } =
      await this.supabase
        .from('transfer_match_participants')
        .select(
          `
        match_id,
        transfer_matches!inner(status)
      `,
        )
        .eq('user_id', userId);

    if (participantError) {
      throw new Error(participantError.message);
    }

    // Filter to only accepted matches
    const acceptedMatchIds = (participantData || [])
      .filter((p: any) => p.transfer_matches?.status === 'accepted')
      .map((p) => p.match_id);

    if (acceptedMatchIds.length === 0) {
      return 0;
    }

    // Count unread messages across all accepted matches
    const { count, error } = await this.supabase
      .from('match_messages')
      .select('*', { count: 'exact', head: true })
      .in('match_id', acceptedMatchIds)
      .eq('is_read', false)
      .neq('sender_id', userId);

    if (error) {
      throw new Error(error.message);
    }

    return count || 0;
  }
}
