import ApiError from "../utils/ApiError.js";

export async function claimAtomicStatusTransition({ repository, id, expectedStatus, targetStatus, update, options = {} }) {
  const claimed = await repository.findOneAndUpdate(
    { _id: id, status: expectedStatus },
    { $set: { ...update, status: targetStatus } },
    { new: true, runValidators: true, ...options }
  );
  if (!claimed) throw new ApiError(409, "Verification was already reviewed or changed by another admin");
  return claimed;
}
