import Content from "../models/Content.js";
import CreatorProfile from "../models/CreatorProfile.js";
import FanProfile from "../models/FanProfile.js";
import FeedPost from "../models/FeedPost.js";
import ProfileRelationship from "../models/ProfileRelationship.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import {
  MAX_PEOPLE,
  ONBOARDING_CATEGORIES,
  requireConsumerRole,
} from "../validators/onboardingValidator.js";
import { buildOrbitForUser } from "./orbitRecommendationService.js";
import { createFollowRelationship } from "./profileRelationshipService.js";

const profileModels = { fan: FanProfile, creator: CreatorProfile };
const defaultPreferences = {
  showMe: "everyone",
  creatorVibe: "any",
  contentDepth: "both",
  discoveryRange: "global",
  creatorStyle: "any",
};

export function initialOnboardingState() {
  return {
    status: "not_started",
    version: 2,
    currentStep: "welcome",
    startedAt: null,
    welcomeCompleted: false,
    interestsCompleted: false,
    accountTypeCompleted: false,
    fillFeedCompleted: false,
    ticketViewed: false,
    instinctsCompleted: false,
    peopleCompleted: false,
    checklistAcknowledged: false,
    skippedSteps: [],
    completedAt: null,
    skippedAt: null,
  };
}

function recoverCurrentStep(state) {
  if (state.status === "completed" || state.status === "skipped") return "completed";
  if (!state.welcomeCompleted) return "welcome";
  if (!state.interestsCompleted) return "interests";
  if (!state.accountTypeCompleted) return "account-type";
  if (!state.fillFeedCompleted) return "fill-feed";
  if (!state.ticketViewed) return "ticket";
  return "complete";
}

function normalizedOnboarding(user) {
  const state = user.onboarding?.status ? user.onboarding : null;
  if (state) {
    const currentStep = recoverCurrentStep(state);
    return {
      status: state.status,
      version: Math.max(2, state.version || 1),
      currentStep,
      startedAt: state.startedAt || null,
      welcomeCompleted: Boolean(state.welcomeCompleted),
      interestsCompleted: Boolean(state.interestsCompleted),
      accountTypeCompleted: Boolean(state.accountTypeCompleted),
      fillFeedCompleted: Boolean(state.fillFeedCompleted),
      ticketViewed: Boolean(state.ticketViewed),
      instinctsCompleted: Boolean(state.instinctsCompleted),
      peopleCompleted: Boolean(state.peopleCompleted),
      checklistAcknowledged: Boolean(state.checklistAcknowledged),
      skippedSteps: state.skippedSteps || [],
      completedAt: state.completedAt || null,
      skippedAt: state.skippedAt || null,
    };
  }

  if (user.role === "admin") {
    return { ...initialOnboardingState(), status: "completed", currentStep: "completed", completedAt: user.createdAt || null };
  }

  return { ...initialOnboardingState(), status: "completed", currentStep: "completed", completedAt: user.createdAt || null };
}

export function onboardingComplete(user) {
  const state = normalizedOnboarding(user);
  return state.status === "completed" || state.status === "skipped";
}

async function getRoleProfile(user) {
  const Model = profileModels[user.role];
  if (!Model) throw new ApiError(400, "Unsupported user role");
  return Model.findOneAndUpdate(
    { user: user._id },
    { $setOnInsert: { user: user._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

function profileInterests(user, profile) {
  if (user.role === "creator") {
    return profile.categories?.length ? profile.categories : profile.category ? [profile.category] : [];
  }
  return profile.interests || [];
}

function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    profileType: user.profileType || (user.creatorApprovalStatus === "approved" ? "creator" : "personal"),
    creatorApprovalStatus: user.creatorApprovalStatus,
    avatar: user.avatar,
    isVerified: user.isVerified,
    status: user.status,
    preferredLanguage: user.preferredLanguage || "en",
    memberNumber: user.memberNumber || null,
    showMemberNumber: user.showMemberNumber !== false,
    businessContactButtons: user.businessContactButtons || [],
    businessContactButtonsConfigured: Boolean(user.businessContactButtonsConfigured),
    dateOfBirth: user.dateOfBirth || null,
    onboarding: normalizedOnboarding(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function categoryAssets() {
  const images = {
    Fitness: "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?auto=format&fit=crop&w=600&q=70",
    Lifestyle: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=70",
    Business: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=70",
    Psychology: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=600&q=70",
    Fashion: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=600&q=70",
    Travel: "https://images.unsplash.com/photo-1527631746610-bca00a040d60?auto=format&fit=crop&w=600&q=70",
    Beauty: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=600&q=70",
    Models: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=70",
    Wellness: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=600&q=70",
    Books: "https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=600&q=70",
    Family: "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=600&q=70",
    Technology: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=70",
    Food: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=600&q=70",
    Photography: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=70",
    Music: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=600&q=70",
    Sports: "https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=600&q=70",
    Entrepreneurship: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=70",
    Culture: "https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&w=600&q=70",
  };
  const emoji = {
    Fitness: "FIT",
    Lifestyle: "LIFE",
    Business: "BIZ",
    Psychology: "MIND",
    Fashion: "STYLE",
    Travel: "TRIP",
    Beauty: "GLOW",
    Models: "LENS",
    Wellness: "CALM",
    Books: "READ",
    Family: "HOME",
    Technology: "TECH",
    Food: "FOOD",
    Photography: "SHOT",
    Music: "MUSIC",
    Sports: "PLAY",
    Entrepreneurship: "BUILD",
    Culture: "ART",
  };

  return ONBOARDING_CATEGORIES.map((name) => ({
    id: name,
    name,
    image: images[name] || "",
    badge: emoji[name] || name.slice(0, 4).toUpperCase(),
  }));
}

async function patchOnboarding(userId, update) {
  const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true, runValidators: true });
  if (!user) throw new ApiError(404, "User not found");
  return user;
}

function startFields(user) {
  return user.onboarding?.startedAt ? {} : { "onboarding.startedAt": new Date() };
}

export async function getOnboardingState(user) {
  if (user.role === "admin") {
    return { user: serializeUser(user), onboarding: normalizedOnboarding(user), categories: [], profile: null };
  }

  requireConsumerRole(user);
  const profile = await getRoleProfile(user);
  const onboarding = normalizedOnboarding(user);
  return {
    user: serializeUser(user),
    onboarding,
    categories: categoryAssets(),
    profile: {
      interests: profileInterests(user, profile),
      discoveryPreferences: { ...defaultPreferences, ...(profile.discoveryPreferences?.toObject?.() || profile.discoveryPreferences || {}) },
      city: profile.city || "",
      country: profile.country || "",
    },
  };
}

export async function saveWelcome(user) {
  requireConsumerRole(user);
  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "in_progress",
    "onboarding.version": 2,
    "onboarding.currentStep": "interests",
    ...startFields(user),
    "onboarding.welcomeCompleted": true,
  });
  return getOnboardingState(updated);
}

export async function saveInterests(user, interests) {
  requireConsumerRole(user);
  const profile = await getRoleProfile(user);
  if (user.role === "creator") {
    profile.categories = interests;
    profile.category = interests[0] || "";
  } else {
    profile.interests = interests;
  }
  await profile.save();

  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "in_progress",
    "onboarding.version": 1,
    "onboarding.currentStep": "account-type",
    ...startFields(user),
    "onboarding.welcomeCompleted": true,
    "onboarding.interestsCompleted": true,
  });
  return getOnboardingState(updated);
}

export async function saveProfileType(user, selection) {
  requireConsumerRole(user);
  const { category, contactButtons = [], profileType } = typeof selection === "string" ? { category: "", contactButtons: [], profileType: selection } : selection;
  const updated = await patchOnboarding(user._id, {
    profileType,
    businessContactButtons: profileType === "business" ? contactButtons : [],
    businessContactButtonsConfigured: profileType === "business",
    "onboarding.status": "in_progress",
    "onboarding.version": 2,
    "onboarding.currentStep": "fill-feed",
    "onboarding.accountTypeCompleted": true,
    ...startFields(user),
  });
  if (["creator", "business"].includes(profileType)) {
    await CreatorProfile.findOneAndUpdate(
      { user: user._id },
      { $set: { category, categories: [category] }, $setOnInsert: { user: user._id, verificationStatus: "pending" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return getOnboardingState(updated);
}

export async function saveInstincts(user, preferences) {
  requireConsumerRole(user);
  const profile = await getRoleProfile(user);
  profile.discoveryPreferences = { ...defaultPreferences, ...(profile.discoveryPreferences?.toObject?.() || {}), ...preferences };
  await profile.save();

  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "in_progress",
    "onboarding.version": 1,
    "onboarding.currentStep": "people",
    ...startFields(user),
    "onboarding.instinctsCompleted": true,
  });
  return getOnboardingState(updated);
}

export async function getSuggestedPeople(user, options = {}) {
  requireConsumerRole(user);
  const limit = options.limit || 12;
  const orbit = await buildOrbitForUser(user, { limit });
  const personalized = (orbit.recommendations || []).slice(0, limit).map((item) => ({
    id: item.id,
    name: item.name,
    username: item.username,
    avatar: item.avatar,
    cover: "",
    verified: item.verified,
    status: item.status || item.happeningNow,
    location: item.location,
    categories: item.interests || item.sharedInterests || [],
    bio: item.bio || "",
    reason: item.reason,
    profileRoute: item.profileRoute,
  }));
  if (personalized.length >= limit) return personalized;

  const excluded = new Set([String(user._id), ...personalized.map((item) => String(item.id))]);
  const followedIds = await ProfileRelationship.distinct("target", { actor: user._id, type: "FOLLOW" });
  followedIds.forEach((id) => excluded.add(String(id)));
  const candidates = await User.find({
    _id: { $nin: [...excluded] },
    role: { $in: ["fan", "creator"] },
    status: "active",
  }).select("name username avatar isVerified role profileType activeStatus lastSeenAt").sort({ avatar: -1, lastSeenAt: -1, createdAt: -1 }).limit(limit - personalized.length).lean();
  if (!candidates.length) return personalized;

  const ids = candidates.map((candidate) => candidate._id);
  const [fanProfiles, creatorProfiles] = await Promise.all([
    FanProfile.find({ user: { $in: ids } }).select("user bio city country interests").lean(),
    CreatorProfile.find({ user: { $in: ids } }).select("user bio city country categories category").lean(),
  ]);
  const fanByUser = new Map(fanProfiles.map((profile) => [String(profile.user), profile]));
  const creatorByUser = new Map(creatorProfiles.map((profile) => [String(profile.user), profile]));
  const additional = candidates.map((candidate) => {
    const professional = ["creator", "business"].includes(candidate.profileType) || candidate.role === "creator";
    const profile = professional ? creatorByUser.get(String(candidate._id)) || fanByUser.get(String(candidate._id)) : fanByUser.get(String(candidate._id)) || creatorByUser.get(String(candidate._id));
    const categories = profile?.categories?.length ? profile.categories : profile?.category ? [profile.category] : profile?.interests || [];
    return {
      id: candidate._id,
      name: candidate.name,
      username: candidate.username,
      avatar: candidate.avatar || "",
      cover: "",
      verified: Boolean(candidate.isVerified),
      status: candidate.activeStatus?.isActive ? candidate.activeStatus.label : "",
      location: { city: profile?.city || "", country: profile?.country || "" },
      categories,
      bio: profile?.bio || "",
      reason: categories.length ? `Interested in ${categories.slice(0, 2).join(" and ")}` : "New on @seen",
      profileRoute: `/profile/${candidate.username}`,
    };
  });
  return [...personalized, ...additional].slice(0, limit);
}

export async function saveSuggestedPeople(user, targetUserIds) {
  requireConsumerRole(user);
  if (targetUserIds.length > MAX_PEOPLE) throw new ApiError(400, `Choose up to ${MAX_PEOPLE} people`);

  const results = [];
  for (const targetUserId of targetUserIds) {
    results.push(await createFollowRelationship({ actor: user, targetUserId }));
  }

  const ticketEligible = Number(user.memberNumber || 0) > 0 && Number(user.memberNumber) <= 100000;
  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "in_progress",
    "onboarding.version": 2,
    "onboarding.currentStep": ticketEligible ? "ticket" : "complete",
    ...startFields(user),
    "onboarding.peopleCompleted": true,
    "onboarding.fillFeedCompleted": true,
    "onboarding.ticketViewed": !ticketEligible,
  });
  return { ...(await getOnboardingState(updated)), selectedPeople: results };
}

export async function acknowledgeTicket(user) {
  requireConsumerRole(user);
  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "in_progress",
    "onboarding.version": 2,
    "onboarding.currentStep": "complete",
    "onboarding.ticketViewed": true,
    ...startFields(user),
  });
  return getOnboardingState(updated);
}

export async function acknowledgeChecklist(user) {
  requireConsumerRole(user);
  const state = normalizedOnboarding(user);
  if (!state.interestsCompleted || !state.instinctsCompleted) {
    throw new ApiError(409, "Finish interests and instinct tuning before reviewing onboarding");
  }

  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "in_progress",
    "onboarding.version": 1,
    "onboarding.currentStep": "complete",
    ...startFields(user),
    "onboarding.peopleCompleted": true,
    "onboarding.checklistAcknowledged": true,
  });
  return getOnboardingState(updated);
}

export async function skipOnboarding(user) {
  requireConsumerRole(user);
  const now = new Date();
  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "skipped",
    "onboarding.version": 1,
    "onboarding.currentStep": "completed",
    "onboarding.startedAt": user.onboarding?.startedAt || now,
    "onboarding.checklistAcknowledged": true,
    "onboarding.skippedSteps": ["welcome", "interests", "instincts", "people", "light-your-world"],
    "onboarding.skippedAt": now,
    "onboarding.completedAt": now,
  });
  return getOnboardingState(updated);
}

export async function completeOnboarding(user) {
  requireConsumerRole(user);
  const state = normalizedOnboarding(user);
  if (!state.interestsCompleted || !state.accountTypeCompleted || !state.fillFeedCompleted) {
    throw new ApiError(409, "Finish interests, account type, and Fill your feed before completing onboarding");
  }
  if (!state.ticketViewed) {
    throw new ApiError(409, "Continue from your @seen ticket before entering the feed");
  }

  const now = new Date();
  const updated = await patchOnboarding(user._id, {
    "onboarding.status": "completed",
    "onboarding.version": 2,
    "onboarding.currentStep": "completed",
    "onboarding.startedAt": state.startedAt || now,
    "onboarding.welcomeCompleted": true,
    "onboarding.peopleCompleted": true,
    "onboarding.accountTypeCompleted": true,
    "onboarding.fillFeedCompleted": true,
    "onboarding.ticketViewed": true,
    "onboarding.completedAt": state.completedAt || now,
  });
  return getOnboardingState(updated);
}

async function profileCompletion(user, profile) {
  if (user.role === "creator") {
    const categories = profile.categories?.length ? profile.categories : profile.category ? [profile.category] : [];
    const checks = [Boolean(user.name), Boolean(user.username), Boolean(user.avatar), Boolean(profile.bio), categories.length > 0];
    return checks.every(Boolean);
  }
  return Boolean(user.name && user.username && user.avatar);
}

export async function recordChecklistEvent(userId, event) {
  if (!event) return null;
  return User.findByIdAndUpdate(userId, { $set: { [`onboardingChecklist.${event}`]: true } }, { new: true, runValidators: true });
}

export async function getChecklist(user) {
  requireConsumerRole(user);
  const profile = await getRoleProfile(user);
  const [createdFirstPost, createdFirstWorld] = await Promise.all([
    FeedPost.exists({ author: user._id, status: "published", deletedAt: null }),
    user.role === "creator"
      ? Content.exists({ creator: user._id, status: { $in: ["PUBLISHED", "published"] } })
      : Promise.resolve(false),
  ]);

  const completedProfile = await profileCompletion(user, profile);
  const interests = profileInterests(user, profile);
  const hasFirstPeople = Boolean(await ProfileRelationship.exists({ actor: user._id, type: "FOLLOW" }));
  const stored = user.onboardingChecklist || {};
  const derived = {
    interestsSelected: interests.length >= 3,
    instinctsTuned: Boolean(user.onboarding?.instinctsCompleted),
    followedFirstPeople: hasFirstPeople || Boolean(user.onboarding?.peopleCompleted && stored.followedFirstPeople),
    profilePhoto: Boolean(user.avatar),
    cityAdded: Boolean(profile.city),
    statusSet: Boolean(profile.orbitStatus),
    coverPhoto: Boolean(profile.coverPhoto),
    bioAdded: Boolean(profile.bio),
    openedOrbit: Boolean(stored.openedOrbit),
    createdFirstPost: Boolean(createdFirstPost || stored.createdFirstPost),
    sharedFirstStory: Boolean(stored.sharedFirstStory),
    createdFirstWorld: Boolean(createdFirstWorld || stored.createdFirstWorld),
    openedStudio: Boolean(stored.openedStudio),
    reactedToStory: Boolean(stored.reactedToStory),
    visitedWorld: Boolean(stored.visitedWorld),
    completedProfile: Boolean(completedProfile || stored.completedProfile),
  };

  const taskDefinitions = user.role === "creator"
    ? [
      ["interestsSelected", "Choose your interests", "Shape Home, Orbit and Worlds", "/onboarding/interests", true],
      ["instinctsTuned", "Tune your instincts", "Set your discovery style", "/onboarding/instincts", true],
      ["followedFirstPeople", "Follow your first people", "Start your Orbit with real signals", "/onboarding/people", false],
      ["profilePhoto", "Add a profile photo", "Help people recognize you", "/settings/profile", false],
      ["cityAdded", "Add your city", "Make local discovery smarter", "/settings/profile", false],
      ["statusSet", "Set your status", "Tell your Orbit what is happening", "/settings/profile", false],
      ["coverPhoto", "Add a cover photo", "Give your profile a visual mood", "/creator/settings/profile", false],
      ["bioAdded", "Add your creator bio", "Explain what your worlds are about", "/creator/settings/profile", false],
      ["sharedFirstStory", "Create your first Story", "A moment that flies for 24 hours", "/wall", false],
      ["createdFirstPost", "Publish your first Home post", "Where you are, what you found", "/wall", false],
      ["createdFirstWorld", "Start your first World", "Package an experience people can unlock", "/create", false],
      ["openedStudio", "Open Creator Studio", "Review your creator tools", "/studio", false],
    ]
    : [
      ["interestsSelected", "Choose your interests", "Shape Home, Orbit and Worlds", "/onboarding/interests", true],
      ["instinctsTuned", "Tune your instincts", "Set your discovery style", "/onboarding/instincts", true],
      ["followedFirstPeople", "Follow your first people", "Start your Orbit with real signals", "/onboarding/people", false],
      ["profilePhoto", "Add a profile photo", "Help people recognize you", "/settings/profile", false],
      ["cityAdded", "Add your city", "Make local discovery smarter", "/settings/profile", false],
      ["statusSet", "Set your status", "Tell your Orbit what is happening", "/settings/profile", false],
      ["visitedWorld", "Explore your first World", "Step inside one creator experience", "/worlds", false],
      ["openedOrbit", "Visit your Orbit", "See people matched to your signals", "/orbit", false],
    ];

  const tasks = taskDefinitions.map(([key, title, description, href, required]) => ({
    key,
    title,
    description,
    href,
    required: Boolean(required),
    optional: !required,
    completed: Boolean(derived[key]),
  }));
  const completed = tasks.filter((task) => task.completed).length;
  const allCompleted = completed === tasks.length;

  if (allCompleted && !stored.completedAt) {
    await User.updateOne({ _id: user._id, "onboardingChecklist.completedAt": { $in: [null, undefined] } }, {
      $set: { "onboardingChecklist.completedAt": new Date() },
    });
  }

  return {
    title: "Light your world",
    subtitle: "A few small steps make your Atseen experience feel alive.",
    completed,
    total: tasks.length,
    progress: Math.round((completed / tasks.length) * 100),
    tasks,
    reward: {
      enabled: false,
      reason: "Stars rewards are disabled because this wallet model does not expose an approved STARS currency.",
      granted: false,
    },
    dismissedAt: stored.dismissedAt || null,
    completedAt: stored.completedAt || (allCompleted ? new Date() : null),
  };
}

export async function dismissChecklist(user) {
  const updated = await User.findByIdAndUpdate(user._id, {
    $set: { "onboardingChecklist.dismissedAt": new Date() },
  }, { new: true, runValidators: true });
  return getChecklist(updated);
}

export const onboardingServiceTestUtils = {
  initialOnboardingState,
  normalizedOnboarding,
};
