process.env.JWT_SECRET = 'test-secret';

// In-memory Redis so the suite needs no external services
jest.mock('../utils/redisClient', () => {
  const Redis = require('ioredis-mock');
  return new Redis();
});

const express = require('express');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const redis = require('../utils/redisClient');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { generateToken } = require('../middleware/auth');

let mongod;
let app;
let user;
let admin;
let token;
let adminToken;

const hoursFromNow = (h) => new Date(Date.now() + h * 60 * 60 * 1000);

// Each test gets its own resource so bookings don't leak between tests
let counter = 0;
const slot = () => {
  counter += 1;
  return {
    resourceId: `LAB-1-${counter}`,
    start: hoursFromNow(5).toISOString(),
    end: hoursFromNow(6).toISOString()
  };
};

const postBooking = (body) =>
  request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(body);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'LabBookerTest' });
  await Booking.init(); // build the unique index before the first insert

  user = await User.create({ name: 'Student', email: 'student@example.com', password: 'x', isConfirmed: true, isApproved: 'approved' });
  admin = await User.create({ name: 'Admin', email: 'admin@example.com', password: 'x', isConfirmed: true, isApproved: 'approved', isAdmin: true });
  token = generateToken(user);
  adminToken = generateToken(admin);

  app = express();
  app.use(express.json());
  app.use('/api/bookings', require('../routes/bookings'));
  app.use('/api/admin', require('../routes/Conflicts'));
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /api/bookings concurrency', () => {
  test('concurrent requests for the same slot: exactly one succeeds, the rest get 409', async () => {
    const body = slot();
    const responses = await Promise.all(Array.from({ length: 10 }, () => postBooking(body)));

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200 || s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(await Booking.countDocuments({ resourceId: body.resourceId })).toBe(1);
  });

  test('unique index alone prevents a double booking when the lock does not stop anyone', async () => {
    // Pretend every request wins the lock; the index must still hold the line
    jest.spyOn(redis, 'set').mockResolvedValue('OK');
    const body = slot();
    const responses = await Promise.all(Array.from({ length: 10 }, () => postBooking(body)));

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200 || s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(await Booking.countDocuments({ resourceId: body.resourceId })).toBe(1);
  });

  test('lock is released after a booking so the next request is judged on availability', async () => {
    const body = slot();
    expect((await postBooking(body)).status).toBe(200);
    expect(await redis.get(`lock:booking:${body.resourceId}`)).toBeNull();

    const second = await postBooking(body);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/not available/);
  });

  test('fails closed with 503 when Redis is unavailable', async () => {
    jest.spyOn(redis, 'set').mockRejectedValue(new Error('Redis down'));
    const body = slot();
    const res = await postBooking(body);

    expect(res.status).toBe(503);
    expect(await Booking.countDocuments({ resourceId: body.resourceId })).toBe(0);
  });
});

describe('PUT /api/bookings/:id', () => {
  test('ignores user and status in the body', async () => {
    const body = slot();
    const created = (await postBooking(body)).body;

    const res = await request(app)
      .put(`/api/bookings/${created._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ user: admin._id, status: 'rejected', start: body.start, end: body.end });

    expect(res.status).toBe(200);
    expect(res.body.user).toBe(String(user._id));
    expect(res.body.status).toBe('approved');
  });
});

describe('/api/admin', () => {
  test('rejects non-admin users with 403', async () => {
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('pending-approvals does not leak password hashes', async () => {
    await User.create({ name: 'New', email: 'new@example.com', password: 'hash', isConfirmed: true, confirmationToken: 'abc' });
    const res = await request(app).get('/api/admin/pending-approvals').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const u of res.body) {
      expect(u.password).toBeUndefined();
      expect(u.confirmationToken).toBeUndefined();
    }
  });
});
