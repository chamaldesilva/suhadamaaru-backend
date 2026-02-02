import { Controller, Get, Query, Param } from '@nestjs/common';
import { SchoolsService } from './schools.service';

@Controller('api')
export class SchoolsController {
  constructor(private schoolsService: SchoolsService) {}

  @Get('schools/search')
  async searchSchools(
    @Query('q') query: string,
    @Query('limit') limit?: number,
  ) {
    return this.schoolsService.searchSchools(
      query,
      limit ? parseInt(limit as any) : 50,
    );
  }

  @Get('schools/:schoolId')
  async getSchoolById(@Param('schoolId') schoolId: string) {
    return this.schoolsService.getSchoolById(schoolId);
  }

  @Get('appointment-categories')
  async getAppointmentCategories() {
    return this.schoolsService.getAppointmentCategories();
  }

  @Get('appointment-categories/:categoryId')
  async getAppointmentCategoryById(@Param('categoryId') categoryId: string) {
    return this.schoolsService.getAppointmentCategoryById(categoryId);
  }

  @Get('subjects')
  async getSubjects(@Query('categoryId') categoryId?: string) {
    return this.schoolsService.getSubjects(categoryId);
  }
}
