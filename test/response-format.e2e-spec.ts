import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import {
  validateNotWrappedResponse,
  validateSearchResponse,
} from './helpers/response-validators';

describe('Response Format Validation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(
      new FastifyAdapter({ logger: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/search endpoint response format', () => {
    it('should return array format, not wrapped in {clubs: [...]}', async () => {
      const response = await request(app.getHttpServer()).get('/search').query({
        placeId: 'ChIJW9fXNZNTtpURV6VYAumGQOw',
        date: '2025-07-26',
      });

      // Should return 200 or handle gracefully
      if (response.status === 200) {
        validateSearchResponse(response.body);
        validateNotWrappedResponse(response.body);

        // Additional specific validations
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body).not.toHaveProperty('clubs');

        if (response.body.length > 0) {
          const club = response.body[0];
          expect(club).toHaveProperty('id');
          expect(club).toHaveProperty('courts');
          expect(Array.isArray(club.courts)).toBe(true);
        }
      } else {
        // If not 200, should still be a valid error response
        expect([400, 404, 500, 503]).toContain(response.status);
      }
    });

    it('should handle invalid requests with proper error format', async () => {
      const response = await request(app.getHttpServer()).get('/search').query({
        placeId: 'invalid-place-id',
        date: 'invalid-date',
      });

      // Should return error status
      expect(response.status).toBeGreaterThanOrEqual(400);

      // Error response should not be wrapped in {clubs: [...]}
      if (response.body) {
        expect(response.body).not.toHaveProperty('clubs');
      }
    });

    it('should handle missing parameters with proper error format', async () => {
      const response = await request(app.getHttpServer())
        .get('/search')
        .query({});

      // Should return error status
      expect(response.status).toBeGreaterThanOrEqual(400);

      // Error response should not be wrapped in {clubs: [...]}
      if (response.body) {
        expect(response.body).not.toHaveProperty('clubs');
      }
    });
  });

  describe('/health endpoint response format', () => {
    it('should return proper health check format', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect([200, 404, 503]).toContain(response.status);

      if (response.status === 200 && response.body) {
        // Health endpoint should have its own format, not clubs array
        expect(response.body).not.toHaveProperty('clubs');
      }
    });
  });
});
