import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class MatchesService {
  constructor(@Inject('SUPABASE_CLIENT') private supabase: SupabaseClient) {}

  /**
   * Process participants to hide profile data when user has profile_visible set to false
   * This respects user privacy settings for profile images and contact info
   */
  private processParticipantsVisibility(
    participants: any[],
    currentUserId: string,
  ): any[] {
    return participants.map((p) => {
      // Don't hide current user's own data
      if (p.user_id === currentUserId) {
        return p;
      }

      // If user has hidden their profile, mask sensitive data
      if (p.user?.profile_visible === false) {
        return {
          ...p,
          user: {
            ...p.user,
            profile_image_url: null,
            mobile: null,
          },
        };
      }

      return p;
    });
  }

  async listMatches(
    userId: string,
    filters: any,
    sort: any,
    limit: number,
    offset: number,
  ) {
    // First get match IDs where user is a participant
    const { data: participantData, error: participantError } =
      await this.supabase
        .from('transfer_match_participants')
        .select('match_id')
        .eq('user_id', userId);

    if (participantError) throw new Error(participantError.message);

    const matchIds = participantData?.map((p) => p.match_id) || [];

    if (matchIds.length === 0) {
      return { data: [], count: 0 };
    }

    // Now get the matches with full details
    let query = this.supabase
      .from('transfer_matches')
      .select(
        `
        *,
        participants:transfer_match_participants(
          *,
          user:users(id, first_name, last_name, email, current_school_id, profile_image_url, profile_visible),
          transfer_request:transfer_requests(*, current_school:schools(*))
        )
      `,
        { count: 'exact' },
      )
      .in('id', matchIds);

    // Apply filters
    if (filters.status) {
      const statuses = String(filters.status).split(',');
      query = query.in('status', statuses);
    }

    if (filters.matchType) {
      const types = String(filters.matchType).split(',');
      query = query.in('match_type', types);
    }

    if (filters.minCompatibility) {
      query = query.gte(
        'compatibility_score',
        parseFloat(String(filters.minCompatibility)),
      );
    }

    // Apply sorting
    const sortField = sort.sortField || 'created_at';
    const sortOrder = sort.sortOrder || 'desc';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(error.message);

    // Add user_response to each match and process visibility
    const enrichedData = data?.map((match) => {
      const processedParticipants = this.processParticipantsVisibility(
        match.participants as any[],
        userId,
      );
      const userParticipant = processedParticipants?.find(
        (p: any) => p.user_id === userId,
      );
      return {
        ...match,
        participants: processedParticipants,
        user_response: userParticipant?.response_status || 'pending',
      };
    });

    return { data: enrichedData || [], count: count || 0 };
  }

  async getMatchDetails(matchId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('transfer_matches')
      .select(
        `
        *,
        participants:transfer_match_participants(
          *,
          user:users(
            id, first_name, last_name, email, mobile,
            current_school_id, current_grade, medium_of_instruction,
            profile_image_url, profile_visible
          ),
          transfer_request:transfer_requests(
            *,
            current_school:schools(*),
            preferred_schools:transfer_request_preferences(*, school:schools(*))
          )
        )
      `,
      )
      .eq('id', matchId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Match not found');
    }

    // Verify user is a participant
    const isParticipant = (data.participants as any[])?.some(
      (p: any) => p.user_id === userId,
    );
    if (!isParticipant) {
      throw new BadRequestException('User is not a participant in this match');
    }

    // Process visibility and add user_response
    const processedParticipants = this.processParticipantsVisibility(
      data.participants as any[],
      userId,
    );
    const userParticipant = processedParticipants?.find(
      (p: any) => p.user_id === userId,
    );
    return {
      ...data,
      participants: processedParticipants,
      user_response: userParticipant?.response_status || 'pending',
    };
  }

  async acceptMatch(matchId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('transfer_match_participants')
      .update({
        response_status: 'accepted',
        responded_at: new Date().toISOString(),
      })
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Check if all participants have accepted
    const { data: allParticipants } = await this.supabase
      .from('transfer_match_participants')
      .select('response_status')
      .eq('match_id', matchId);

    const allAccepted = allParticipants?.every(
      (p) => p.response_status === 'accepted',
    );

    if (allAccepted) {
      // Update match status
      await this.supabase
        .from('transfer_matches')
        .update({ status: 'accepted' })
        .eq('id', matchId);

      // Get all transfer request IDs in this match
      const { data: participants } = await this.supabase
        .from('transfer_match_participants')
        .select('transfer_request_id')
        .eq('match_id', matchId);

      const requestIds = participants?.map((p) => p.transfer_request_id) || [];

      // Update all transfer requests to 'matched' status
      if (requestIds.length > 0) {
        await this.supabase
          .from('transfer_requests')
          .update({ status: 'matched' })
          .in('id', requestIds);
      }
    }

    return data;
  }

  async rejectMatch(matchId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('transfer_match_participants')
      .update({
        response_status: 'rejected',
        responded_at: new Date().toISOString(),
      })
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    // Get all transfer request IDs in this match
    const { data: participants } = await this.supabase
      .from('transfer_match_participants')
      .select('transfer_request_id')
      .eq('match_id', matchId);

    const requestIds = participants?.map((p) => p.transfer_request_id) || [];

    // Update match status to rejected (one rejection rejects the whole match)
    await this.supabase
      .from('transfer_matches')
      .update({ status: 'rejected' })
      .eq('id', matchId);

    // Return transfer requests back to 'submitted' status so they can be matched again
    if (requestIds.length > 0) {
      await this.supabase
        .from('transfer_requests')
        .update({ status: 'submitted' })
        .in('id', requestIds);
    }

    return data;
  }

  async getParticipants(matchId: string, userId: string) {
    // Verify user is a participant in this match
    const { data: isParticipant, error: participantError } = await this.supabase
      .from('transfer_match_participants')
      .select('id')
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .single();

    if (participantError || !isParticipant) {
      throw new ForbiddenException('You are not a participant in this match');
    }

    const { data, error } = await this.supabase
      .from('transfer_match_participants')
      .select(
        `
        *,
        user:users(id, first_name, last_name, email, mobile, current_school_id, current_grade, medium_of_instruction, profile_image_url, profile_visible),
        transfer_request:transfer_requests(*, current_school:schools(*))
      `,
      )
      .eq('match_id', matchId)
      .order('swap_position', { ascending: true });

    if (error) throw new Error(error.message);

    return this.processParticipantsVisibility(data || [], userId);
  }

  async getPendingMatchesCount(userId: string) {
    const { data: participantData, error: participantError } =
      await this.supabase
        .from('transfer_match_participants')
        .select('match_id')
        .eq('user_id', userId)
        .eq('response_status', 'pending');

    if (participantError) throw new Error(participantError.message);

    const matchIds = participantData?.map((p) => p.match_id) || [];

    if (matchIds.length === 0) return { count: 0 };

    const { count, error } = await this.supabase
      .from('transfer_matches')
      .select('*', { count: 'exact', head: true })
      .in('id', matchIds)
      .eq('status', 'pending');

    if (error) throw new Error(error.message);

    return { count: count || 0 };
  }

  async getAcceptedMatchesCount(userId: string) {
    const { data: participantData, error: participantError } =
      await this.supabase
        .from('transfer_match_participants')
        .select('match_id')
        .eq('user_id', userId);

    if (participantError) throw new Error(participantError.message);

    const matchIds = participantData?.map((p) => p.match_id) || [];

    if (matchIds.length === 0) return { count: 0 };

    const { count, error } = await this.supabase
      .from('transfer_matches')
      .select('*', { count: 'exact', head: true })
      .in('id', matchIds)
      .eq('status', 'accepted');

    if (error) throw new Error(error.message);

    return { count: count || 0 };
  }

  async getRecentMatches(userId: string, limit: number) {
    const { data: participantData, error: participantError } =
      await this.supabase
        .from('transfer_match_participants')
        .select('match_id')
        .eq('user_id', userId);

    if (participantError) throw new Error(participantError.message);

    const matchIds = participantData?.map((p) => p.match_id) || [];

    if (matchIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('transfer_matches')
      .select(
        `
        *,
        participants:transfer_match_participants(
          *,
          user:users(id, first_name, last_name, current_school_id, profile_image_url, profile_visible)
        )
      `,
      )
      .in('id', matchIds)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);

    // Add user_response to each match and process visibility
    const enrichedData = data?.map((match) => {
      const processedParticipants = this.processParticipantsVisibility(
        match.participants as any[],
        userId,
      );
      const userParticipant = processedParticipants?.find(
        (p: any) => p.user_id === userId,
      );
      return {
        ...match,
        participants: processedParticipants,
        user_response: userParticipant?.response_status || 'pending',
      };
    });

    return enrichedData || [];
  }
}
