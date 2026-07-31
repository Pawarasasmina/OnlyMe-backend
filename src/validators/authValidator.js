import ApiError from "../utils/ApiError.js";
import { validateDisplayName, validateUsername } from "./profileValidator.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicRoles = new Set(["fan", "creator"]);

export function validateEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    throw new ApiError(400, "Please enter your email address.", {
      email: "Please enter your email address.",
    });
  }

  if (!emailPattern.test(normalizedEmail)) {
    throw new ApiError(400, "Please enter a valid email address.", {
      email: "Please enter a valid email address.",
    });
  }

  return normalizedEmail;
}

export function validatePasswordPolicy(password, label = "Password") {
  if (!password) {
    throw new ApiError(400, `${label} is required`, {
      password: `${label} is required`,
    });
  }

  const normalizedPassword = String(password);

  if (normalizedPassword.length < 8 || normalizedPassword.length > 128) {
    throw new ApiError(400, `${label} must contain 8 to 128 characters`, {
      password: `${label} must contain 8 to 128 characters`,
    });
  }

  if (!/[A-Z]/.test(normalizedPassword) || !/[a-z]/.test(normalizedPassword) || !/[0-9]/.test(normalizedPassword)) {
    throw new ApiError(400, `${label} must include uppercase, lowercase, and number characters`, {
      password: `${label} must include uppercase, lowercase, and number characters`,
    });
  }

  return normalizedPassword;
}

export function validateRegisterPayload(payload) {
  const { name, username, email, password, confirmPassword, termsAccepted } = payload;
  const role = payload.role || "fan";

  if (!name) {
    throw new ApiError(400, "Please enter your full name.", {
      name: "Please enter your full name.",
    });
  }

  if (!username) {
    throw new ApiError(400, "Please choose a username.", {
      username: "Please choose a username.",
    });
  }

  if (!publicRoles.has(role)) {
    throw new ApiError(400, "Please select a valid account type.", {
      role: "Please select a valid account type.",
    });
  }

  const displayName = validateDisplayName(name);
  const normalizedUsername = validateUsername(username);
  const normalizedEmail = validateEmail(email);
  const normalizedPassword = validatePasswordPolicy(password);

  if (!confirmPassword) {
    throw new ApiError(400, "Please confirm your password.", {
      confirmPassword: "Please confirm your password.",
    });
  }

  if (normalizedPassword !== String(confirmPassword)) {
    throw new ApiError(400, "Passwords do not match.", {
      confirmPassword: "Passwords do not match.",
    });
  }

  if (termsAccepted !== true) {
    throw new ApiError(400, "Please accept the terms and conditions.", {
      termsAccepted: "Please accept the terms and conditions.",
    });
  }

  return {
    name: displayName,
    username: normalizedUsername,
    email: normalizedEmail,
    password: normalizedPassword,
    role,
  };
}

export function validateLoginPayload(payload) {
  const email = validateEmail(payload?.email);
  const password = payload?.password;

  if (!password) {
    throw new ApiError(400, "Please enter your password.", {
      password: "Please enter your password.",
    });
  }

  return {
    email,
    password,
  };
}

export function validateForgotPasswordPayload(payload) {
  return {
    email: validateEmail(payload?.email),
  };
}

export function validateResetPasswordPayload(payload) {
  const token = String(payload?.token || "").trim();
  const newPassword = payload?.newPassword;
  const confirmPassword = payload?.confirmPassword;

  if (!token) {
    throw new ApiError(400, "Reset token is required");
  }

  const normalizedPassword = validatePasswordPolicy(newPassword, "Password");

  if (!confirmPassword) {
    throw new ApiError(400, "Confirm password is required");
  }

  if (normalizedPassword !== String(confirmPassword)) {
    throw new ApiError(400, "Passwords do not match");
  }

  return {
    token,
    newPassword: normalizedPassword,
    confirmPassword,
  };
}
