import ApiError from "../utils/ApiError.js";
import { validateDisplayName, validateUsername } from "./profileValidator.js";
import { ageOn } from "../services/monetizationEligibilityService.js";

export function normalizePhone(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  const hasPlus = input.startsWith("+");
  const digits = input.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new ApiError(400, "A valid phone number is required");
  return `${hasPlus ? "+" : ""}${digits}`;
}

function registrationContact(payload) {
  const value = String(payload.identifier ?? payload.email ?? payload.phone ?? "").trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "A valid email address is required");
    return { email, phone: "" };
  }
  return { email: "", phone: normalizePhone(value) };
}

export function validateRegisterPayload(payload) {
  const { username, password, dateOfBirth } = payload;
  const firstName = String(payload.firstName || "").trim();
  const lastName = String(payload.lastName || "").trim();
  const name = String(payload.name || [firstName, lastName].filter(Boolean).join(" ")).trim();

  if (!firstName || !name || !username || !(payload.identifier || payload.email || payload.phone) || !password || !dateOfBirth) {
    throw new ApiError(400, "Name, username, email or phone, password, and birthday are required");
  }

  const contact = registrationContact(payload);

  if (String(password).length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  const birthday = new Date(dateOfBirth);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateOfBirth)) || Number.isNaN(birthday.getTime()) || birthday.toISOString().slice(0, 10) !== dateOfBirth || birthday > new Date()) {
    throw new ApiError(400, "Enter a valid birthday");
  }
  if (ageOn(birthday) < 18) throw new ApiError(400, "You must be 18 or older to use @seen", "MINIMUM_AGE_REQUIRED");

  return {
    name: validateDisplayName(name),
    firstName: validateDisplayName(firstName).slice(0, 30),
    lastName: lastName ? validateDisplayName(lastName).slice(0, 30) : "",
    username: validateUsername(username),
    ...contact,
    password,
    dateOfBirth: birthday,
  };
}

export function validateLoginPayload(payload) {
  const identifier = String(payload.identifier ?? payload.email ?? "").trim();
  const { password } = payload;

  if (!identifier || !password) {
    throw new ApiError(400, "Username, email or phone and password are required");
  }
  return { identifier, password };
}
