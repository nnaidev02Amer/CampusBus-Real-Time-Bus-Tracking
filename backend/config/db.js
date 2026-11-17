import mongoose from "mongoose";

// CampusBus uses a LOCAL MongoDB (see README). The connection string comes only
// from MONGO_URI - there is deliberately no default or fallback host.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      "MONGO_URI is not set. Copy backend/.env.example to backend/.env " +
        "(local MongoDB: mongodb://127.0.0.1:27017/campusbus).",
    );
  }
  await mongoose.connect(uri);
  const { host, port, name } = mongoose.connection;
  console.log(`MongoDB connected (${host}:${port}/${name})`);
  if (!LOCAL_HOSTS.has(host)) {
    console.warn(
      `[db] Connected to a non-local MongoDB host (${host}). This project is intended for local MongoDB only.`,
    );
  }
}
