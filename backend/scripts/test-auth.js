// Auth integration test. Run against a THROWAWAY database, e.g.:
//   MONGO_URI=mongodb://127.0.0.1:27017/campusbus_authtest JWT_SECRET=test PORT=5055 node server.js
//   MONGO_URI=mongodb://127.0.0.1:27017/campusbus_authtest JWT_SECRET=test API=http://localhost:5055/api node scripts/test-auth.js
import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";

const API = process.env.API || "http://localhost:5055/api";
if (!/authtest/.test(process.env.MONGO_URI || "")) {
  console.error("Refusing to run: MONGO_URI must point to a database containing 'authtest'.");
  process.exit(1);
}
let pass = 0, fail = 0;
const call = async (method, path, body, token) => {
  const r = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
};

await mongoose.connect(process.env.MONGO_URI);
await User.deleteMany({});
const hash = await bcrypt.hash("password123", 10);
const admin = await User.create({ name: "A", email: "admin@t.io", password: hash, role: "admin" });
const driver = await User.create({ name: "D", email: "driver@t.io", password: hash, role: "driver" });

// Registration
let r = await call("POST", "/auth/register", { name: "S", email: "stu@t.io", password: "password123" });
check("register student -> 201, role student", r.status === 201 && r.data.user?.role === "student" && !!r.data.token);
const studentToken = r.data.token;
r = await call("POST", "/auth/register", { name: "X", email: "x@t.io", password: "password123", role: "admin" });
check("register cannot self-assign admin role", r.status === 201 && r.data.user?.role === "student");
r = await call("POST", "/auth/register", { name: "S", email: "STU@t.io", password: "password123" });
check("duplicate email -> 409", r.status === 409);
r = await call("POST", "/auth/register", { name: "S", email: "bad", password: "password123" });
check("invalid email -> 400", r.status === 400, r.data.message);
r = await call("POST", "/auth/register", { name: "S", email: "s2@t.io", password: "short" });
check("short password -> 400", r.status === 400, r.data.message);
r = await call("POST", "/auth/register", { name: "S", email: "s3@t.io", password: "a".repeat(80) });
check("over-long password -> 400", r.status === 400, r.data.message);
r = await call("POST", "/auth/register", { name: "", email: "s4@t.io", password: "password123" });
check("missing name -> 400", r.status === 400);
r = await call("POST", "/auth/register", { name: "S", email: { $ne: "" }, password: { a: 1 } });
check("non-string fields -> 400 (no 500)", r.status === 400);

// Login
r = await call("POST", "/auth/login", { email: "admin@t.io", password: "password123" });
check("admin login -> 200", r.status === 200 && r.data.user?.role === "admin");
const adminToken = r.data.token;
check("password not leaked in login response", !JSON.stringify(r.data).includes("password"));
r = await call("POST", "/auth/login", { email: "driver@t.io", password: "password123" });
check("driver login -> 200", r.status === 200 && r.data.user?.role === "driver");
const driverToken = r.data.token;
r = await call("POST", "/auth/login", { email: "stu@t.io", password: "password123" });
check("student login -> 200", r.status === 200 && r.data.user?.role === "student");
r = await call("POST", "/auth/login", { email: "admin@t.io", password: "wrongpass" });
check("wrong password -> 401", r.status === 401, r.data.message);
r = await call("POST", "/auth/login", { email: "nobody@t.io", password: "password123" });
check("unknown email -> 401 (same message)", r.status === 401 && r.data.message === "Invalid email or password");
r = await call("POST", "/auth/login", {});
check("empty login -> 400", r.status === 400);
r = await call("POST", "/auth/login", { email: { $gt: "" }, password: { $gt: "" } });
check("login operator injection -> 400", r.status === 400);

// Token handling
r = await call("GET", "/auth/me", null, studentToken);
check("/me with valid token -> 200", r.status === 200 && r.data.user?.email === "stu@t.io");
r = await call("GET", "/auth/me");
check("/me without token -> 401", r.status === 401);
r = await call("GET", "/auth/me", null, "garbage.token.value");
check("/me with garbage token -> 401", r.status === 401 && r.data.code === "TOKEN_INVALID");
const expired = jwt.sign({ id: admin._id, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "-1h" });
r = await call("GET", "/auth/me", null, expired);
check("/me with expired token -> 401 TOKEN_EXPIRED", r.status === 401 && r.data.code === "TOKEN_EXPIRED", r.data.message);
const forged = jwt.sign({ id: admin._id, role: "admin" }, "wrong-secret");
r = await call("GET", "/auth/me", null, forged);
check("/me with wrongly-signed token -> 401", r.status === 401);

// Role-based access
r = await call("GET", "/users", null, adminToken);
check("admin GET /users -> 200", r.status === 200);
r = await call("GET", "/users", null, studentToken);
check("student GET /users -> 403", r.status === 403);
r = await call("GET", "/users", null, driverToken);
check("driver GET /users -> 403", r.status === 403);
r = await call("GET", "/users");
check("anonymous GET /users -> 401", r.status === 401);
r = await call("POST", "/trips/start", {}, studentToken);
check("student POST /trips/start -> 403", r.status === 403);
r = await call("POST", "/trips/start", {}, adminToken);
check("admin POST /trips/start -> 403", r.status === 403);
r = await call("POST", "/buses", {}, driverToken);
check("driver POST /buses -> 403", r.status === 403);
r = await call("GET", "/buses", null, studentToken);
check("student GET /buses -> 200", r.status === 200);
r = await call("GET", "/buses");
check("anonymous GET /buses -> 401", r.status === 401);
r = await call("GET", "/simulator/status", null, studentToken);
check("student hits simulator -> 403", r.status === 403);

// Deactivated account
await User.updateOne({ _id: driver._id }, { isActive: false });
r = await call("POST", "/auth/login", { email: "driver@t.io", password: "password123" });
check("deactivated login -> 403", r.status === 403);
r = await call("GET", "/auth/me", null, driverToken);
check("deactivated user's existing token -> 403", r.status === 403);

await User.deleteMany({});
await mongoose.disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
