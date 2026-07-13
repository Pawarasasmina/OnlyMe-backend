import ApiError from "../utils/ApiError.js";

export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "support",
  "api",
  "login",
  "register",
  "settings",
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

  if (normalized.length > 30) {
    throw new ApiError(400, "Username must be 30 characters or less");
  }

  if (!usernamePattern.test(normalized)) {
    throw new ApiError(400, "Username may contain only letters, numbers, underscores, and periods");
  }

  if (RESERVED_USERNAMES.has(normalized)) {
    throw new ApiError(400, "That username is reserved");
  }

  return normalized;
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
    throw new ApiError(400, "Username cannot be changed after registration");
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

      if (categories.length > 3) {
        throw new ApiError(400, "Creators can choose up to 3 categories");
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
        categories: categories?.map((category) => sanitizeText(category, 40)).filter(Boolean),
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
    return {
      common,
      profile: {
        bio: payload.bio === undefined ? undefined : sanitizeText(payload.bio, 300),
        profileVisibility: validateVisibility(payload.profileVisibility),
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
      phoneNumber: payload.phoneNumber === undefined ? undefined : sanitizeText(payload.phoneNumber, 40),
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
