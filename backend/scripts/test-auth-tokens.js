import 'dotenv/config';
import http from 'http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { assertSafeDatabase } from "../config/dbGuard.js";

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;
if (!JWT_SECRET || !MONGO_URI) {
  console.error('Set JWT_SECRET and MONGO_URI (e.g. in backend/.env) before running this script.');
  process.exit(1);
}

assertSafeDatabase("test-auth-tokens");
async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  
  const student = await User.findOne({ role: 'student' });
  console.log('Found student:', student?.email, student?._id);

  if (!student) {
    console.error('No student found in DB');
    process.exit(1);
  }

  // 1. Generate a valid token
  const validToken = jwt.sign({ id: student._id, role: student.role }, JWT_SECRET, { expiresIn: '7d' });
  console.log('\n--- 1. Testing valid token with /api/auth/me ---');
  await testMe(validToken, (status, data) => {
    console.log('Valid token status:', status);
    console.log('Valid token user email:', data.user?.email);
  });

  // 2. Generate an expired token (expired 1 hour ago)
  const expiredToken = jwt.sign({ id: student._id, role: student.role }, JWT_SECRET, { expiresIn: '-1h' });
  console.log('\n--- 2. Testing expired token with /api/auth/me ---');
  await testMe(expiredToken, (status, data) => {
    console.log('Expired token status (expect 401):', status);
    console.log('Expired token message:', data.message);
  });

  // 3. Testing without token
  console.log('\n--- 3. Testing request without token ---');
  await testMe(null, (status, data) => {
    console.log('No token status (expect 401):', status);
    console.log('No token message:', data.message);
  });

  console.log('\nAll token tests passed successfully.');
  process.exit(0);
}

function testMe(token, cb) {
  return new Promise((resolve) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    http.get('http://localhost:5000/api/auth/me', { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          cb(res.statusCode, JSON.parse(data));
        } catch {
          cb(res.statusCode, data);
        }
        resolve();
      });
    });
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
