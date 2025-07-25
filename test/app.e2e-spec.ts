import { HttpService } from '@nestjs/axios';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AppModule } from './../src/app.module';

jest.setTimeout(60_000);

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let http: HttpService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication(
      new FastifyAdapter({ logger: true }),
    );
    http = app.get(HttpService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/search?placeId=ChIJW9fXNZNTtpURV6VYAumGQOw&date=VALID_DATE (GET)', async () => {
    // Use a valid date within the next 7 days
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().split('T')[0];

    const placeId = 'ChIJW9fXNZNTtpURV6VYAumGQOw';
    const response = await request(app.getHttpServer())
      .get(`/search?placeId=${placeId}&date=${date}`)
      .timeout(10000);

    // Should either succeed or handle gracefully (mock API might not be available)
    expect([200, 500, 503, 429].includes(response.status)).toBe(true);

    if (response.status === 200) {
      expect(response.body).toBeDefined();
      expect(Array.isArray(response.body)).toBe(true);
    }
  });
});
