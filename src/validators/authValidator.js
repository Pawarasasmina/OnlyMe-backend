import ApiError from "../utils/ApiError.js";
import { validateDisplayName, validateUsername } from "./profileValidator.js";

export function validateRegisterPayload(payload) {
  const { name, username, email, password, dateOfBirth } = payload;

  if (!name || !username || !email || !password || !dateOfBirth) {
    throw new ApiError(400, "Name, username, email, password, and birthday are required");
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new ApiError(400, "A valid email address is required");
  }

  if (String(password).length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const birthday = new Date(dateOfBirth);
  if (Number.isNaN(birthday.getTime()) || birthday > new Date()) {
    throw new ApiError(400, "Enter a valid birthday");
  }

  return {
    name: validateDisplayName(name),
    username: validateUsername(username),
    email: normalizedEmail,
    password,
    dateOfBirth: birthday,
  };
}

export function validateLoginPayload(payload) {
  const { email, password } = payload;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }
}
