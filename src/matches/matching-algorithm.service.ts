import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { NotificationsService } from '../common/services/notifications.service';

interface TransferRequest {
  id: string;
  user_id: string;
  current_school_id: number;
  appointment_category_id: number;
  medium_of_instruction: string;
  geographic_flexibility: 'district_only' | 'province_wide' | 'nationwide';
  urgency_level: 'normal' | 'high';
  willing_temporary_transfer: boolean;
  status: string;
  preferred_schools: Array<{
    preferred_school_id: number;
    preference_rank: number;
  }>;
  subjects: number[];
  current_school?: {
    division?: {
      zone?: {
        district?: { id: number; province?: { id: number } };
      };
    };
  };
}

interface CompatibilityScore {
  total: number;
  breakdown: {
    mutualSchools: number;
    geographicCompatibility: number;
    subjects: number;
    urgency: number;
  };
}

@Injectable()
export class MatchingAlgorithmService {
  private readonly logger = new Logger(MatchingAlgorithmService.name);

  constructor(
    @Inject('SUPABASE_CLIENT') private supabase: SupabaseClient,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Main method to run the matching algorithm
   * Finds compatible transfer requests and creates matches
   */
  async runMatchingAlgorithm(): Promise<{
    matchesCreated: number;
    requestsProcessed: number;
  }> {
    this.logger.log('Starting matching algorithm...');

    try {
      // Get all submitted requests that are not in any active match
      const eligibleRequests = await this.getEligibleRequests();
      this.logger.log(`Found ${eligibleRequests.length} eligible requests`);

      if (eligibleRequests.length > 0) {
        this.logger.log(
          'Eligible request details:',
          eligibleRequests.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            current_school: r.current_school_id,
            preferences: r.preferred_schools?.length || 0,
            subjects: r.subjects?.length || 0,
            hasGeoData: !!r.current_school,
          })),
        );
      }

      if (eligibleRequests.length < 2) {
        this.logger.log('Not enough requests to create matches');
        return { matchesCreated: 0, requestsProcessed: 0 };
      }

      let matchesCreated = 0;
      const processedRequestIds = new Set<string>();

      // Try to find three-way matches first (higher priority)
      if (eligibleRequests.length >= 3) {
        const threeWayMatches = await this.findThreeWayMatches(
          eligibleRequests,
          processedRequestIds,
        );
        matchesCreated += threeWayMatches;
      }

      // Try to find two-way matches
      for (let i = 0; i < eligibleRequests.length; i++) {
        if (processedRequestIds.has(eligibleRequests[i].id)) continue;

        for (let j = i + 1; j < eligibleRequests.length; j++) {
          if (processedRequestIds.has(eligibleRequests[j].id)) continue;

          const request1 = eligibleRequests[i];
          const request2 = eligibleRequests[j];

          // Skip if both requests belong to the same user
          if (request1.user_id === request2.user_id) continue;

          // Check if they can be matched
          const compatibility = this.calculateCompatibility(request1, request2);

          if (compatibility.total >= 50) {
            // Minimum 50% compatibility required
            const matchId = await this.createTwoWayMatch(
              request1,
              request2,
              compatibility,
            );

            if (matchId) {
              matchesCreated++;
              processedRequestIds.add(request1.id);
              processedRequestIds.add(request2.id);
              this.logger.log(
                `Created match between ${request1.id} and ${request2.id} (score: ${compatibility.total})`,
              );
              break; // Move to next request1
            }
          }
        }
      }

      this.logger.log(
        `Matching algorithm completed. Created ${matchesCreated} matches, processed ${processedRequestIds.size} requests`,
      );

      return {
        matchesCreated,
        requestsProcessed: processedRequestIds.size,
      };
    } catch (error) {
      this.logger.error('Error running matching algorithm:', error);
      throw error;
    }
  }

  /**
   * Get all eligible transfer requests for matching
   */
  private async getEligibleRequests(): Promise<TransferRequest[]> {
    // Get submitted requests that haven't expired
    const { data: requests, error: requestsError } = await this.supabase
      .from('transfer_requests')
      .select(
        `
        id,
        user_id,
        current_school_id,
        appointment_category_id,
        medium_of_instruction,
        geographic_flexibility,
        urgency_level,
        willing_temporary_transfer,
        status,
        expires_at,
        current_school:schools!current_school_id(
          id,
          division:divisions(
            zone:zones(
              district:districts(
                id,
                province:provinces(id)
              )
            )
          )
        )
      `,
      )
      .eq('status', 'submitted')
      .gt('expires_at', new Date().toISOString());

    if (requestsError) throw new Error(requestsError.message);

    if (!requests || requests.length === 0) return [];

    // Get preferred schools for each request
    const requestIds = requests.map((r) => r.id);
    const { data: preferences } = await this.supabase
      .from('transfer_request_preferences')
      .select('transfer_request_id, preferred_school_id, preference_rank')
      .in('transfer_request_id', requestIds);

    // Get subjects for each request
    const { data: requestSubjects } = await this.supabase
      .from('transfer_request_subjects')
      .select('transfer_request_id, subject_id')
      .in('transfer_request_id', requestIds);

    // Get requests that are already in pending or accepted matches
    const { data: existingParticipants } = await this.supabase
      .from('transfer_match_participants')
      .select(
        `
        transfer_request_id,
        match:transfer_matches!match_id(status)
      `,
      )
      .in('transfer_request_id', requestIds);

    const requestsInActiveMatches = new Set(
      existingParticipants
        ?.filter(
          (p: any) =>
            p.match?.status === 'pending' || p.match?.status === 'accepted',
        )
        .map((p: any) => p.transfer_request_id) || [],
    );

    // Build full request objects
    const enrichedRequests: TransferRequest[] = requests
      .filter((r) => !requestsInActiveMatches.has(r.id))
      .map((request) => {
        // Extract current school data (Supabase returns arrays due to join)
        const currentSchoolData = Array.isArray(request.current_school)
          ? request.current_school[0]
          : request.current_school;

        let transformedSchool: TransferRequest['current_school'] = undefined;

        if (currentSchoolData) {
          const divisionRaw: any = Array.isArray(currentSchoolData.division)
            ? currentSchoolData.division[0]
            : currentSchoolData.division;
          const zoneRaw: any =
            divisionRaw && Array.isArray(divisionRaw.zone)
              ? divisionRaw.zone[0]
              : divisionRaw?.zone;
          const districtRaw: any =
            zoneRaw && Array.isArray(zoneRaw.district)
              ? zoneRaw.district[0]
              : zoneRaw?.district;
          const provinceRaw: any =
            districtRaw && Array.isArray(districtRaw.province)
              ? districtRaw.province[0]
              : districtRaw?.province;

          transformedSchool = {
            division: {
              zone: {
                district: districtRaw
                  ? {
                      id: districtRaw.id,
                      province: provinceRaw
                        ? { id: provinceRaw.id }
                        : undefined,
                    }
                  : undefined,
              },
            },
          };
        }

        return {
          ...request,
          current_school: transformedSchool,
          preferred_schools:
            preferences
              ?.filter((p) => p.transfer_request_id === request.id)
              .map((p) => ({
                preferred_school_id: p.preferred_school_id,
                preference_rank: p.preference_rank,
              })) || [],
          subjects:
            requestSubjects
              ?.filter((s) => s.transfer_request_id === request.id)
              .map((s) => s.subject_id.toString()) || [],
        };
      });

    return enrichedRequests;
  }

  /**
   * Check if two requests have at least one common subject
   * Returns true if they share at least one subject, false otherwise
   */
  private hasCommonSubjects(
    request1: TransferRequest,
    request2: TransferRequest,
  ): boolean {
    // Both must have subjects defined
    if (request1.subjects.length === 0 || request2.subjects.length === 0) {
      return false;
    }

    // Check for at least one common subject
    return request1.subjects.some((s) => request2.subjects.includes(s));
  }

  /**
   * Calculate three-way match compatibility score
   */

  private calculateThreeWayCompatibility(
    reqA: TransferRequest,
    reqB: TransferRequest,
    reqC: TransferRequest,
  ): number {
    let score = 0;

    // 1. Preference rank scoring (40 points max)
    // How highly each teacher ranked their destination
    // A → B's school, B → C's school, C → A's school
    const aRankForB =
      reqA.preferred_schools.find(
        (ps) => ps.preferred_school_id === reqB.current_school_id,
      )?.preference_rank || 5;
    const bRankForC =
      reqB.preferred_schools.find(
        (ps) => ps.preferred_school_id === reqC.current_school_id,
      )?.preference_rank || 5;
    const cRankForA =
      reqC.preferred_schools.find(
        (ps) => ps.preferred_school_id === reqA.current_school_id,
      )?.preference_rank || 5;

    // Higher rank (lower number) = more points
    // Rank 1 = 10 points, Rank 2 = 8 points, etc.
    const preferenceScore =
      (6 - aRankForB) * 2 + (6 - bRankForC) * 2 + (6 - cRankForA) * 2;
    score += Math.min(preferenceScore, 40);

    // 2. Subject overlap scoring (30 points max)
    const abSubjects = reqA.subjects.filter((s) =>
      reqB.subjects.includes(s),
    ).length;
    const bcSubjects = reqB.subjects.filter((s) =>
      reqC.subjects.includes(s),
    ).length;
    const caSubjects = reqC.subjects.filter((s) =>
      reqA.subjects.includes(s),
    ).length;
    const avgSubjectOverlap = (abSubjects + bcSubjects + caSubjects) / 3;
    score += Math.min(Math.round(avgSubjectOverlap * 10), 30);

    // 3. Geographic feasibility (20 points max)
    // Check if transfers are within each teacher's flexibility
    const aGeoScore = this.getGeoFeasibilityScore(reqA, reqB);
    const bGeoScore = this.getGeoFeasibilityScore(reqB, reqC);
    const cGeoScore = this.getGeoFeasibilityScore(reqC, reqA);
    score += Math.round((aGeoScore + bGeoScore + cGeoScore) / 3);

    // 4. Urgency matching (10 points max)
    const allHigh =
      reqA.urgency_level === 'high' &&
      reqB.urgency_level === 'high' &&
      reqC.urgency_level === 'high';
    const allNormal =
      reqA.urgency_level === 'normal' &&
      reqB.urgency_level === 'normal' &&
      reqC.urgency_level === 'normal';
    if (allHigh || allNormal) {
      score += 10;
    } else {
      score += 5; // Mixed urgency
    }

    return Math.min(score, 100);
  }

  /**
   * Calculate geographic feasibility score between two requests
   */

  private getGeoFeasibilityScore(
    from: TransferRequest,
    to: TransferRequest,
  ): number {
    const fromDistrict = from.current_school?.division?.zone?.district?.id;
    const toDistrict = to.current_school?.division?.zone?.district?.id;
    const fromProvince =
      from.current_school?.division?.zone?.district?.province?.id;
    const toProvince =
      to.current_school?.division?.zone?.district?.province?.id;

    if (!fromDistrict || !toDistrict) return 0;

    const sameDistrict = fromDistrict === toDistrict;
    const sameProvince = fromProvince === toProvince;
    const flexibility = from.geographic_flexibility;

    if (sameDistrict) return 20;
    if (
      sameProvince &&
      (flexibility === 'province_wide' || flexibility === 'nationwide')
    )
      return 15;
    if (flexibility === 'nationwide') return 10;
    return 0;
  }

  /**
   * Calculate compatibility score between two transfer requests
   */
  private calculateCompatibility(
    request1: TransferRequest,
    request2: TransferRequest,
  ): CompatibilityScore {
    let mutualSchools = 0;
    let geographicCompatibility = 0;
    let subjects = 0;
    let urgency = 0;

    // 1. Check for mutual school preferences (40 points max)
    const r1SchoolIds = request1.preferred_schools.map(
      (ps) => ps.preferred_school_id,
    );
    const r2SchoolIds = request2.preferred_schools.map(
      (ps) => ps.preferred_school_id,
    );

    // Check if request1's current school is in request2's preferences
    const r1CurrentInR2Prefs = r2SchoolIds.includes(request1.current_school_id);
    const r2CurrentInR1Prefs = r1SchoolIds.includes(request2.current_school_id);

    if (r1CurrentInR2Prefs && r2CurrentInR1Prefs) {
      // Perfect mutual match!
      mutualSchools = 40;

      // Add bonus based on preference ranks
      const r1Rank =
        request2.preferred_schools.find(
          (ps) => ps.preferred_school_id === request1.current_school_id,
        )?.preference_rank || 5;
      const r2Rank =
        request1.preferred_schools.find(
          (ps) => ps.preferred_school_id === request2.current_school_id,
        )?.preference_rank || 5;

      // Higher rank (lower number) = more points
      const rankBonus = (6 - r1Rank + (6 - r2Rank)) * 2; // Max 20 extra points
      mutualSchools = Math.min(40 + rankBonus, 60); // Cap at 60
    }

    // 2. Geographic compatibility (20 points max)
    const geoScore = this.calculateGeographicCompatibility(request1, request2);
    geographicCompatibility = geoScore;

    // 3. Subject overlap (15 points max) - MANDATORY: at least one common subject required
    if (request1.subjects.length > 0 && request2.subjects.length > 0) {
      const commonSubjects = request1.subjects.filter((s) =>
        request2.subjects.includes(s),
      );
      const subjectOverlapRatio =
        (commonSubjects.length /
          Math.max(request1.subjects.length, request2.subjects.length)) *
        15;
      subjects = Math.round(subjectOverlapRatio);
    }

    // 4. Urgency matching (5 points)
    if (request1.urgency_level === request2.urgency_level) {
      urgency = 5;
    } else if (
      request1.urgency_level === 'high' ||
      request2.urgency_level === 'high'
    ) {
      urgency = 2; // Partial credit
    }

    this.logger.debug(
      `Compatibility between ${request1.id} and ${request2.id}: mutualSchools=${mutualSchools}, geo=${geographicCompatibility}, subjects=${subjects}, urgency=${urgency}`,
    );

    const total = mutualSchools + geographicCompatibility + subjects + urgency;

    return {
      total: Math.min(Math.round(total), 100),
      breakdown: {
        mutualSchools: Math.round(mutualSchools),
        geographicCompatibility: Math.round(geographicCompatibility),
        subjects: Math.round(subjects),
        urgency: Math.round(urgency),
      },
    };
  }

  /**
   * Calculate geographic compatibility between two requests
   */
  private calculateGeographicCompatibility(
    request1: TransferRequest,
    request2: TransferRequest,
  ): number {
    const r1DistrictId = request1.current_school?.division?.zone?.district?.id;
    const r1ProvinceId =
      request1.current_school?.division?.zone?.district?.province?.id;
    const r2DistrictId = request2.current_school?.division?.zone?.district?.id;
    const r2ProvinceId =
      request2.current_school?.division?.zone?.district?.province?.id;

    if (!r1DistrictId || !r2DistrictId) return 0;

    const sameDistrict = r1DistrictId === r2DistrictId;
    const sameProvince = r1ProvinceId === r2ProvinceId;

    // Check if the match is within both users' flexibility
    const r1Flexibility = request1.geographic_flexibility;
    const r2Flexibility = request2.geographic_flexibility;

    // Best case: same district
    if (sameDistrict) {
      return 20; // Full points
    }

    // Same province
    if (sameProvince) {
      // Both must allow province-wide or nationwide
      if (
        (r1Flexibility === 'province_wide' || r1Flexibility === 'nationwide') &&
        (r2Flexibility === 'province_wide' || r2Flexibility === 'nationwide')
      ) {
        return 15;
      }
      return 5; // Reduced points if flexibility doesn't match
    }

    // Different provinces - both must allow nationwide
    if (r1Flexibility === 'nationwide' && r2Flexibility === 'nationwide') {
      return 10;
    }

    return 0; // No geographic compatibility
  }

  /**
   * Find three-way matches (circular swaps: A→B→C→A)
   */
  private async findThreeWayMatches(
    eligibleRequests: TransferRequest[],
    processedRequestIds: Set<string>,
  ): Promise<number> {
    let matchesCreated = 0;

    for (let i = 0; i < eligibleRequests.length; i++) {
      if (processedRequestIds.has(eligibleRequests[i].id)) continue;

      for (let j = i + 1; j < eligibleRequests.length; j++) {
        if (processedRequestIds.has(eligibleRequests[j].id)) continue;

        for (let k = j + 1; k < eligibleRequests.length; k++) {
          if (processedRequestIds.has(eligibleRequests[k].id)) continue;

          const reqA = eligibleRequests[i];
          const reqB = eligibleRequests[j];
          const reqC = eligibleRequests[k];

          // Skip if any two requests belong to the same user
          if (
            reqA.user_id === reqB.user_id ||
            reqB.user_id === reqC.user_id ||
            reqA.user_id === reqC.user_id
          )
            continue;

          // Check if they form a valid circular swap
          // A wants B's school, B wants C's school, C wants A's school
          const aWantsB = reqA.preferred_schools.some(
            (ps) => ps.preferred_school_id === reqB.current_school_id,
          );
          const bWantsC = reqB.preferred_schools.some(
            (ps) => ps.preferred_school_id === reqC.current_school_id,
          );
          const cWantsA = reqC.preferred_schools.some(
            (ps) => ps.preferred_school_id === reqA.current_school_id,
          );

          if (aWantsB && bWantsC && cWantsA) {
            // Validate same appointment category and medium
            const sameCategory =
              reqA.appointment_category_id === reqB.appointment_category_id &&
              reqB.appointment_category_id === reqC.appointment_category_id;
            const sameMedium =
              reqA.medium_of_instruction === reqB.medium_of_instruction &&
              reqB.medium_of_instruction === reqC.medium_of_instruction;

            if (!sameCategory || !sameMedium) {
              continue;
            }

            // MANDATORY: Check subject overlap for all three pairs
            // Each pair must have at least one common subject
            const abHasCommon = this.hasCommonSubjects(reqA, reqB);
            const bcHasCommon = this.hasCommonSubjects(reqB, reqC);
            const caHasCommon = this.hasCommonSubjects(reqC, reqA);

            if (!abHasCommon || !bcHasCommon || !caHasCommon) {
              this.logger.debug(
                `Three-way match skipped due to no common subjects: A-B: ${abHasCommon}, B-C: ${bcHasCommon}, C-A: ${caHasCommon}`,
              );
              continue;
            }

            // Calculate average compatibility
            const threeWayScore = this.calculateThreeWayCompatibility(
              reqA,
              reqB,
              reqC,
            );

            this.logger.debug(
              `Three-way compatibility for ${reqA.id}, ${reqB.id}, ${reqC.id}: ${threeWayScore}`,
            );

            if (threeWayScore >= 40) {
              // Lower threshold for three-way
              const matchId = await this.createThreeWayMatch(
                [reqA, reqB, reqC],
                threeWayScore,
              );

              if (matchId) {
                matchesCreated++;
                processedRequestIds.add(reqA.id);
                processedRequestIds.add(reqB.id);
                processedRequestIds.add(reqC.id);
                this.logger.log(
                  `Created three-way match: ${reqA.id} → ${reqB.id} → ${reqC.id} (score: ${threeWayScore})`,
                );
              }
            }
          }
        }
      }
    }

    return matchesCreated;
  }

  /**
   * Create a three-way match in the database
   */
  private async createThreeWayMatch(
    requests: [TransferRequest, TransferRequest, TransferRequest],
    compatibilityScore: number,
  ): Promise<string | null> {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { data: match, error: matchError } = await this.supabase
        .from('transfer_matches')
        .insert({
          match_type: 'circular_three',
          compatibility_score: compatibilityScore,
          match_algorithm_version: 'v1.0',
          status: 'pending',
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (matchError || !match) {
        this.logger.error('Error creating three-way match:', matchError);
        return null;
      }

      // Create participants
      const participants = requests.map((req, index) => ({
        match_id: match.id,
        transfer_request_id: req.id,
        user_id: req.user_id,
        swap_position: index + 1,
        response_status: 'pending',
      }));

      const { error: participantsError } = await this.supabase
        .from('transfer_match_participants')
        .insert(participants);

      if (participantsError) {
        this.logger.error(
          'Error creating three-way participants:',
          participantsError,
        );
        await this.supabase
          .from('transfer_matches')
          .delete()
          .eq('id', match.id);
        return null;
      }

      // Get user details for notifications
      const userIds = requests.map((req) => req.user_id);
      const { data: users } = await this.supabase
        .from('users')
        .select('id, first_name, last_name')
        .in('id', userIds);

      if (users) {
        const participantsForNotification = users.map((user: any) => ({
          userId: user.id,
          userName: `${user.first_name} ${user.last_name}`,
        }));

        await this.notificationsService.notifyMatchCreated(
          match.id,
          participantsForNotification,
        );
      }

      return match.id;
    } catch (error) {
      this.logger.error('Exception in createThreeWayMatch:', error);
      return null;
    }
  }

  /**
   * Create a two-way match in the database
   */
  private async createTwoWayMatch(
    request1: TransferRequest,
    request2: TransferRequest,
    compatibility: CompatibilityScore,
  ): Promise<string | null> {
    try {
      // Basic validation
      if (
        request1.appointment_category_id !== request2.appointment_category_id
      ) {
        this.logger.warn(
          'Appointment categories do not match, skipping match creation',
        );
        return null;
      }

      if (request1.medium_of_instruction !== request2.medium_of_instruction) {
        this.logger.warn(
          'Medium of instruction does not match, skipping match creation',
        );
        return null;
      }

      // MANDATORY: At least one common subject required
      if (!this.hasCommonSubjects(request1, request2)) {
        this.logger.warn(
          'No common subjects between requests, skipping match creation',
        );
        return null;
      }

      // Create the match
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Matches expire in 7 days

      const { data: match, error: matchError } = await this.supabase
        .from('transfer_matches')
        .insert({
          match_type: 'two_way',
          compatibility_score: compatibility.total,
          match_algorithm_version: 'v1.0',
          status: 'pending',
          expires_at: expiresAt.toISOString(),
        })
        .select()
        .single();

      if (matchError || !match) {
        this.logger.error('Error creating match:', matchError);
        return null;
      }

      // Create participants
      const participants = [
        {
          match_id: match.id,
          transfer_request_id: request1.id,
          user_id: request1.user_id,
          swap_position: 1,
          response_status: 'pending',
        },
        {
          match_id: match.id,
          transfer_request_id: request2.id,
          user_id: request2.user_id,
          swap_position: 2,
          response_status: 'pending',
        },
      ];

      const { error: participantsError } = await this.supabase
        .from('transfer_match_participants')
        .insert(participants);

      if (participantsError) {
        this.logger.error('Error creating participants:', participantsError);
        // Rollback: delete the match
        await this.supabase
          .from('transfer_matches')
          .delete()
          .eq('id', match.id);
        return null;
      }

      // Get user details for notifications
      const { data: users } = await this.supabase
        .from('users')
        .select('id, first_name, last_name')
        .in('id', [request1.user_id, request2.user_id]);

      if (users) {
        const participantsForNotification = users.map((user: any) => ({
          userId: user.id,
          userName: `${user.first_name} ${user.last_name}`,
        }));

        await this.notificationsService.notifyMatchCreated(
          match.id,
          participantsForNotification,
        );
      }

      return match.id;
    } catch (error) {
      this.logger.error('Exception in createTwoWayMatch:', error);
      return null;
    }
  }

  /**
   * Expire old pending matches
   */
  async expireOldMatches(): Promise<number> {
    const { data, error } = await this.supabase
      .from('transfer_matches')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString())
      .select();

    if (error) {
      this.logger.error('Error expiring matches:', error);
      throw new Error(error.message);
    }

    const expiredCount = data?.length || 0;
    if (expiredCount > 0) {
      this.logger.log(`Expired ${expiredCount} old matches`);
    }

    return expiredCount;
  }
}
