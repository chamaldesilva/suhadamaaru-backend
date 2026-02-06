import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  CreateTransferRequestDto,
  UpdateTransferRequestDto,
} from './dto/transfer-request.dto';
import { PurchasesService } from '../purchases/purchases.service';

@Injectable()
export class TransferRequestsService {
  constructor(
    @Inject('SUPABASE_CLIENT') private supabase: SupabaseClient,
    private purchasesService: PurchasesService,
  ) {}

  async createRequest(userId: string, createDto: CreateTransferRequestDto) {
    // Get user's current school and appointment details
    const { data: user } = await this.supabase
      .from('users')
      .select(
        'current_school_id, appointment_category_id, medium_of_instruction',
      )
      .eq('id', userId)
      .single();

    if (!user || !user.current_school_id) {
      throw new BadRequestException('User profile incomplete');
    }

    const { preferred_school_ids, subject_ids, ...requestData } = createDto;

    // Create the transfer request
    const { data: request, error: requestError } = await this.supabase
      .from('transfer_requests')
      .insert({
        user_id: userId,
        current_school_id: user.current_school_id,
        appointment_category_id: user.appointment_category_id,
        medium_of_instruction: user.medium_of_instruction,
        ...requestData,
        status: 'draft',
      })
      .select()
      .single();

    if (requestError) throw new Error(requestError.message);

    // Add preferred schools
    if (preferred_school_ids && preferred_school_ids.length > 0) {
      const preferredSchools = preferred_school_ids.map((schoolId, index) => ({
        transfer_request_id: request.id,
        preferred_school_id: schoolId,
        preference_rank: index + 1,
      }));

      await this.supabase
        .from('transfer_request_preferences')
        .insert(preferredSchools);
    }

    // Add subjects
    if (subject_ids && subject_ids.length > 0) {
      const subjects = subject_ids.map((subjectId) => ({
        transfer_request_id: request.id,
        subject_id: subjectId,
      }));

      await this.supabase.from('transfer_request_subjects').insert(subjects);
    }

    return request;
  }

  async updateRequest(
    requestId: string,
    userId: string,
    updateDto: UpdateTransferRequestDto,
  ) {
    const { preferred_school_ids, subject_ids, ...updateData } = updateDto;

    const { data: request, error: updateError } = await this.supabase
      .from('transfer_requests')
      .update(updateData)
      .eq('id', requestId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw new Error(updateError.message);

    // Update preferred schools if provided
    if (preferred_school_ids !== undefined) {
      await this.supabase
        .from('transfer_request_preferences')
        .delete()
        .eq('transfer_request_id', requestId);

      if (preferred_school_ids.length > 0) {
        const preferredSchools = preferred_school_ids.map(
          (schoolId, index) => ({
            transfer_request_id: requestId,
            preferred_school_id: schoolId,
            preference_rank: index + 1,
          }),
        );

        await this.supabase
          .from('transfer_request_preferences')
          .insert(preferredSchools);
      }
    }

    // Update subjects if provided
    if (subject_ids !== undefined) {
      await this.supabase
        .from('transfer_request_subjects')
        .delete()
        .eq('transfer_request_id', requestId);

      if (subject_ids.length > 0) {
        const subjects = subject_ids.map((subjectId) => ({
          transfer_request_id: requestId,
          subject_id: subjectId,
        }));

        await this.supabase.from('transfer_request_subjects').insert(subjects);
      }
    }

    return request;
  }

  async listRequests(
    userId: string,
    filters: any,
    sort: any,
    limit: number,
    offset: number,
  ) {
    let query = this.supabase
      .from('transfer_requests')
      .select(
        '*, current_school:schools(*), preferred_schools:transfer_request_preferences(*, school:schools(*))',
        { count: 'exact' },
      )
      .eq('user_id', userId)
      .is('deleted_at', null);

    // Apply filters
    if (filters.status) {
      const statuses = String(filters.status).split(',');
      query = query.in('status', statuses);
    }

    if (filters.urgencyLevel) {
      const levels = String(filters.urgencyLevel).split(',');
      query = query.in('urgency_level', levels);
    }

    if (filters.dateFrom) {
      query = query.gte('created_at', String(filters.dateFrom));
    }

    if (filters.dateTo) {
      query = query.lte('created_at', String(filters.dateTo));
    }

    // Apply sorting
    const sortField = (sort.sortField as string) || 'created_at';
    const sortOrder = (sort.sortOrder as string) || 'desc';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(error.message);

    return { data: data || [], count: count || 0 };
  }

  async getRequestById(requestId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('transfer_requests')
      .select(
        `
        *,
        current_school:schools!inner(
          *,
          division:divisions!inner(
            *,
            zone:zones!inner(
              *,
              district:districts!inner(
                *,
                province:provinces!inner(*)
              )
            )
          )
        ),
        preferred_schools:transfer_request_preferences(
          *,
          school:schools!inner(
            *,
            division:divisions!inner(
              *,
              zone:zones!inner(
                *,
                district:districts!inner(
                  *,
                  province:provinces!inner(*)
                )
              )
            )
          )
        )
      `,
      )
      .eq('id', requestId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      throw new NotFoundException('Transfer request not found');
    }

    return data;
  }

  async submitRequest(requestId: string, userId: string, purchaseId?: string) {
    // Consume a purchase credit (use specific purchase or oldest available)
    let consumedPurchase: any;
    if (purchaseId) {
      // Verify the specific purchase belongs to user and is validated
      const { data: purchase } = await this.supabase
        .from('purchases')
        .select('*')
        .eq('id', purchaseId)
        .eq('user_id', userId)
        .eq('status', 'validated')
        .single();

      if (!purchase) {
        throw new BadRequestException('Invalid or already used purchase');
      }
      consumedPurchase = await this.purchasesService.consumePurchase(
        userId,
        requestId,
      );
    } else {
      // Try to consume the oldest available credit
      consumedPurchase = await this.purchasesService.consumePurchase(
        userId,
        requestId,
      );
    }

    // Submit the transfer request
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    const { data, error } = await this.supabase
      .from('transfer_requests')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq('id', requestId)
      .eq('user_id', userId)
      .eq('status', 'draft')
      .select()
      .single();

    if (error || !data) {
      // Rollback the purchase consumption if submission fails
      if (consumedPurchase) {
        await this.purchasesService.rollbackConsumption(consumedPurchase.id);
      }
      if (error) throw new Error(error.message);
      throw new NotFoundException(
        'Transfer request not found or already submitted',
      );
    }

    return data;
  }

  async withdrawRequest(requestId: string, userId: string) {
    // First check if request is part of any active matches
    const { data: matchParticipations } = await this.supabase
      .from('transfer_match_participants')
      .select(
        `
        match_id,
        transfer_matches!match_id(status)
      `,
      )
      .eq('transfer_request_id', requestId);

    // Check if request is in any pending or accepted matches
    const activeMatches = matchParticipations?.filter((mp: any) => {
      const matchStatus = mp.transfer_matches?.status;
      return matchStatus === 'pending' || matchStatus === 'accepted';
    });

    if (activeMatches && activeMatches.length > 0) {
      const matchStatus = (activeMatches[0] as any).transfer_matches?.status;

      if (matchStatus === 'accepted') {
        throw new BadRequestException(
          'This request is part of an accepted match. Please contact an administrator.',
        );
      }

      if (matchStatus === 'pending') {
        throw new BadRequestException(
          'This request is part of a pending match. Please reject the match first before withdrawing.',
        );
      }
    }

    // If no active matches, proceed with withdrawal
    const { data, error } = await this.supabase
      .from('transfer_requests')
      .update({ status: 'withdrawn' })
      .eq('id', requestId)
      .eq('user_id', userId)
      .in('status', ['submitted', 'under_review'])
      .select()
      .single();

    if (error) throw new Error(error.message);
    if (!data)
      throw new NotFoundException(
        'Transfer request not found or cannot be withdrawn',
      );

    return data;
  }

  async deleteRequest(requestId: string, userId: string) {
    // Check if the request exists and belongs to the user
    const { data: existingRequest } = await this.supabase
      .from('transfer_requests')
      .select('status')
      .eq('id', requestId)
      .eq('user_id', userId)
      .single();

    if (!existingRequest) {
      throw new NotFoundException('Transfer request not found');
    }

    if (existingRequest.status !== 'draft') {
      throw new BadRequestException(
        'Only draft requests can be deleted. To remove a submitted request, use the withdraw endpoint instead.',
      );
    }

    // Proceed with soft delete (only for draft status)
    const { error } = await this.supabase
      .from('transfer_requests')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('user_id', userId)
      .eq('status', 'draft');

    if (error) throw new Error(error.message);
  }

  async getActiveRequestsCount(userId: string) {
    const { count, error } = await this.supabase
      .from('transfer_requests')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['submitted', 'under_review'])
      .is('deleted_at', null);

    if (error) throw new Error(error.message);

    return { count: count || 0 };
  }

  async getDraftRequestsCount(userId: string) {
    const { count, error } = await this.supabase
      .from('transfer_requests')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'draft')
      .is('deleted_at', null);

    if (error) throw new Error(error.message);

    return { count: count || 0 };
  }

  async getActiveRequest(userId: string) {
    const { data, error } = await this.supabase
      .from('transfer_requests')
      .select(
        '*, current_school:schools(*), preferred_schools:transfer_request_preferences(*, school:schools(*))',
      )
      .eq('user_id', userId)
      .in('status', ['submitted', 'under_review', 'matched'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);

    return data;
  }

  async getPreferredSchools(requestId: string) {
    const { data, error } = await this.supabase
      .from('transfer_request_preferences')
      .select('*, school:schools(*)')
      .eq('transfer_request_id', requestId)
      .order('preference_rank', { ascending: true });

    if (error) throw new Error(error.message);

    return data || [];
  }
}
