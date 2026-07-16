import mongoose from "mongoose";

const unsupported = (error) => /Transaction numbers are only allowed|does not support transactions|replica set/i.test(error?.message || "");

export async function withTransactionFallback(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (error) {
    if (!unsupported(error)) throw error;
  } finally {
    await session.endSession();
  }
  return work(null);
}
