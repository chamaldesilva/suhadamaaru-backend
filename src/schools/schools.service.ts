import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SchoolsService {
  constructor(@Inject('SUPABASE_CLIENT') private supabase: SupabaseClient) {}

  async searchSchools(query: string, limit: number = 50) {
    const { data, error } = await this.supabase
      .from('schools')
      .select(
        `
        id,
        name,
        division:divisions!inner(
          id,
          name,
          zone:zones!inner(
            id,
            name,
            district:districts!inner(
              id,
              name,
              province:provinces!inner(
                id,
                name
              )
            )
          )
        )
      `,
      )
      .ilike('name', `%${query}%`)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  }

  async getSchoolById(schoolId: string) {
    const { data, error } = await this.supabase
      .from('schools')
      .select(
        `
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
      `,
      )
      .eq('id', schoolId)
      .single();

    if (error || !data) {
      throw new NotFoundException('School not found');
    }

    return data;
  }

  async getAppointmentCategories() {
    const { data, error } = await this.supabase
      .from('appointment_categories')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      throw new Error(error.message);
    }

    return data || [];
  }

  async getAppointmentCategoryById(categoryId: string) {
    const { data, error } = await this.supabase
      .from('appointment_categories')
      .select('*')
      .eq('id', categoryId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Appointment category not found');
    }

    return data;
  }

  async getSubjects(categoryId?: string) {
    let query = this.supabase
      .from('subjects')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (categoryId) {
      query = query.eq('appointment_category_id', parseInt(categoryId));
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    return data || [];
  }
}
