import ApiError from "../utils/ApiError.js";

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "atseen",
  "fan",
  "fans",
  "help",
  "login",
  "moderator",
  "profile",
  "register",
  "root",
  "seen",
  "settings",
  "signup",
  "support",
  "system",
  "dashboard",
  "creator",
  "creators",
  "user",
  "users",
  "onlyme",
]);

const usernamePattern = /^[a-z0-9_.]+$/;
const allowedVisibility = new Set(["public", "private"]);

export function sanitizeText(value, maxLength) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .replace(/[<>]/g, "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);

      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
}

export function normalizeUsername(username) {
  return String(username ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

export function validateUsername(username) {
  const normalized = normalizeUsername(username);

  if (!normalized) {
    throw new ApiError(400, "Username is required");
  }

  if (normalized.length < 3) {
    throw new ApiError(400, "Username must be at least 3 characters");
  }

  if (normalized.length > 30) {
    throw new ApiError(400, "Username must be 30 characters or less");
  }

  if (!usernamePattern.test(normalized)) {
    throw new ApiError(400, "Username may contain only letters, numbers, underscores, and periods");
  }

  if (/^[_.]|[_.]$/.test(normalized)) {
    throw new ApiError(400, "Username cannot start or end with a separator");
  }

  if (/[_.]{2,}/.test(normalized)) {
    throw new ApiError(400, "Username cannot contain repeated separators");
  }

  if (RESERVED_USERNAMES.has(normalized)) {
    throw new ApiError(400, "That username is reserved");
  }

  return normalized;
}

export function validateUsernameCandidate(username) {
  try {
    return { username: validateUsername(username), valid: true, reason: null, message: null };
  } catch (error) {
    const normalized = normalizeUsername(username);
    let reason = "invalid";

    if (!normalized) reason = "required";
    else if (RESERVED_USERNAMES.has(normalized)) reason = "reserved";
    else if (normalized.length < 3 || normalized.length > 30) reason = "length";
    else if (/^[_.]|[_.]$/.test(normalized)) reason = "separator";

    return { username: normalized, valid: false, reason, message: error.message };
  }
}

export function validateDisplayName(name) {
  const displayName = sanitizeText(name, 50);

  if (!displayName) {
    throw new ApiError(400, "Display name is required");
  }

  return displayName;
}

function validateVisibility(value) {
  if (value === undefined) {
    return undefined;
  }

  if (!allowedVisibility.has(value)) {
    throw new ApiError(400, "Profile visibility must be public or private");
  }

  return value;
}

function validateNotificationPreferences(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return allowedKeys.reduce((preferences, key) => {
    if (value[key] !== undefined) {
      preferences[key] = Boolean(value[key]);
    }

    return preferences;
  }, {});
}

export function validatePrivacySettings(value, allowedKeys) {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return allowedKeys.reduce((settings, key) => {
    if (value[key] !== undefined) {
      settings[key] = Boolean(value[key]);
    }

    return settings;
  }, {});
}

function privacyKeysFor(role) {
  if (role === "creator") {
    return [
      "showOnlineStatus",
      "showActivityStatus",
      "showLocation",
      "allowDiscovery",
      "allowDirectMessages",
      "allowMentions",
      "allowTags",
      "showFollowers",
    ];
  }

  if (role === "fan") {
    return [
      "showOnlineStatus",
      "showActivityStatus",
      "showLocation",
      "allowDiscovery",
      "allowDirectMessages",
      "allowMentions",
    ];
  }

  return ["showOnlineStatus", "showActivityStatus", "allowDirectMessages"];
}

function notificationKeysFor(role) {
  return role === "admin" ? ["email", "inApp", "security"] : ["email", "inApp", "marketing"];
}

export function validateSettingsPayload(role, type, payload) {
  const preferredLanguage =
    payload.preferredLanguage === undefined ? undefined : sanitizeText(payload.preferredLanguage, 12) || "en";
  const timezone = payload.timezone === undefined ? undefined : sanitizeText(payload.timezone, 80) || "UTC";

  if (type === "privacy") {
    return {
      profileVisibility: role === "admin" ? undefined : validateVisibility(payload.profileVisibility),
      privacySettings: validatePrivacySettings(payload.privacySettings || payload, privacyKeysFor(role)),
    };
  }

  if (type === "notifications") {
    const notificationPreferences = validateNotificationPreferences(
      payload.notificationPreferences || payload,
      notificationKeysFor(role)
    ) || {};

    if (role === "admin" && notificationPreferences.security === false) {
      throw new ApiError(400, "Security notifications cannot be disabled for admins");
    }

    return { notificationPreferences };
  }

  if (type === "account") {
    return {
      phoneNumber: role === "admin" && payload.phoneNumber !== undefined ? sanitizeText(payload.phoneNumber, 40) : undefined,
      preferredLanguage,
      timezone,
    };
  }

  throw new ApiError(400, "Unsupported settings type");
}

function validateSocialLinks(value) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new ApiError(400, "Social links must be a list");
  }

  if (value.length > 5) {
    throw new ApiError(400, "You can add up to 5 social links");
  }

  return value
    .map((link) => {
      const platform = sanitizeText(link?.platform, 40);
      const url = String(link?.url ?? "").trim();

      if (!platform || !url) {
        throw new ApiError(400, "Each social link needs a platform and URL");
      }

      try {
        const parsed = new URL(url);

        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new Error("Invalid protocol");
        }
      } catch {
        throw new ApiError(400, "Social links must use valid http or https URLs");
      }

      return { platform, url: url.slice(0, 300) };
    });
}

export function validateRoleProfilePayload(role, payload, user) {
  const common = {};

  if (payload.displayName !== undefined || payload.name !== undefined) {
    common.name = validateDisplayName(payload.displayName ?? payload.name);
  }

  if (payload.username !== undefined) {
    const nextUsername = validateUsername(payload.username);
    if (nextUsername !== user.username) {
      common.username = nextUsername;
    }
  }

  const preferredLanguage =
    payload.preferredLanguage === undefined ? undefined : sanitizeText(payload.preferredLanguage, 12) || "en";
  const timezone = payload.timezone === undefined ? undefined : sanitizeText(payload.timezone, 80) || "UTC";

  if (role === "creator") {
    const categories = payload.categories === undefined ? undefined : payload.categories;

    if (categories !== undefined) {
      if (!Array.isArray(categories) || categories.length === 0) {
        throw new ApiError(400, "Creators must choose at least one category");
      }
    }

    const subscriptionPriceCents =
      payload.subscriptionPriceCents === undefined ? undefined : Number(payload.subscriptionPriceCents);
    const ppmPrice = payload.ppmPrice === undefined ? undefined : Number(payload.ppmPrice);
    const ppmEnabled = payload.ppmEnabled === undefined ? undefined : Boolean(payload.ppmEnabled);

    if (subscriptionPriceCents !== undefined && (subscriptionPriceCents < 300 || subscriptionPriceCents > 99999)) {
      throw new ApiError(400, "Monthly subscription price must be between $3.00 and $999.99");
    }

    if ((ppmEnabled || payload.ppmEnabled === undefined) && ppmPrice !== undefined && (ppmPrice < 10 || ppmPrice > 1000)) {
      throw new ApiError(400, "Pay-per-message price must be between 10 and 1,000 coins");
    }

    if (payload.nsfwEnabled === true && !user.isVerified) {
      throw new ApiError(400, "NSFW profiles require verification before they can be enabled");
    }

    return {
      common,
      profile: {
        bio: payload.bio === undefined ? undefined : sanitizeText(payload.bio, 500),
        orbitQuote: payload.orbitQuote === undefined ? undefined : sanitizeText(payload.orbitQuote, 240),
        categories: categories?.map((category) => sanitizeText(category, 40)).filter(Boolean),
        orbitStatus: payload.orbitStatus === undefined ? undefined : sanitizeText(payload.orbitStatus, 80),
        city: payload.city === undefined ? undefined : sanitizeText(payload.city, 80),
        country: payload.country === undefined ? undefined : sanitizeText(payload.country, 80),
        socialLinks: validateSocialLinks(payload.socialLinks),
        subscriptionPriceCents,
        monthlyPrice: subscriptionPriceCents === undefined ? undefined : Math.round(subscriptionPriceCents) / 100,
        nsfwEnabled: payload.nsfwEnabled === undefined ? undefined : Boolean(payload.nsfwEnabled),
        freePreviewEnabled: payload.freePreviewEnabled === undefined ? undefined : Boolean(payload.freePreviewEnabled),
        messagingEnabled: payload.messagingEnabled === undefined ? undefined : Boolean(payload.messagingEnabled),
        ppmEnabled,
        ppmPrice,
        profileVisibility: validateVisibility(payload.profileVisibility),
        privacySettings: validatePrivacySettings(payload.privacySettings, privacyKeysFor(role)),
        preferredLanguage,
        timezone,
        notificationPreferences: validateNotificationPreferences(payload.notificationPreferences, [
          "email",
          "inApp",
          "marketing",
        ]),
      },
    };
  }

  if (role === "fan") {
    const interests = payload.interests === undefined ? undefined : payload.interests;

    if (interests !== undefined && (!Array.isArray(interests) || interests.length > 8)) {
      throw new ApiError(400, "Fans can choose up to 8 interests");
    }

    return {
      common,
      profile: {
        bio: payload.bio === undefined ? undefined : sanitizeText(payload.bio, 300),
        interests: interests?.map((interest) => sanitizeText(interest, 40)).filter(Boolean),
        orbitStatus: payload.orbitStatus === undefined ? undefined : sanitizeText(payload.orbitStatus, 80),
        city: payload.city === undefined ? undefined : sanitizeText(payload.city, 80),
        country: payload.country === undefined ? undefined : sanitizeText(payload.country, 80),
        profileVisibility: validateVisibility(payload.profileVisibility),
        privacySettings: validatePrivacySettings(payload.privacySettings, privacyKeysFor(role)),
        preferredLanguage,
        timezone,
        notificationPreferences: validateNotificationPreferences(payload.notificationPreferences, [
          "email",
          "inApp",
          "marketing",
        ]),
      },
    };
  }

  return {
    common,
    profile: {
      bio: payload.bio === undefined ? undefined : sanitizeText(payload.bio, 300),
      phoneNumber: payload.phoneNumber === undefined ? undefined : sanitizeText(payload.phoneNumber, 40),
      profileVisibility: validateVisibility(payload.profileVisibility),
      privacySettings: validatePrivacySettings(payload.privacySettings, privacyKeysFor(role)),
      preferredLanguage,
      timezone,
      notificationPreferences: validateNotificationPreferences(payload.notificationPreferences, [
        "email",
        "inApp",
        "security",
      ]),
    },
  };
}
