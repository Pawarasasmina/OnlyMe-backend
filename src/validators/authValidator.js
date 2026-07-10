import ApiError from "../utils/ApiError.js";

export function validateRegisterPayload(payload) {
  const { name, username, email, password } = payload;

  if (!name || !username || !email || !password) {
    throw new ApiError(400, "Name, username, email, and password are required");
  }
}

export function validateLoginPayload(payload) {
  const { email, password } = payload;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }
}
