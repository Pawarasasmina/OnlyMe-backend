import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },
    passwordChangedAt: { type: Date, select: false },
    resetPasswordToken: { type: String, select: false, index: true },
    resetPasswordExpires: { type: Date, select: false },
    role: {
      type: String,
      enum: ["fan", "creator", "admin"],
      default: "fan",
    },
    creatorApprovalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", null],
      default: null,
    },
    avatar: {
      type: String,
      default: "",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },
    messagingRestrictedUntil: { type: Date, default: null },
    messagingRestrictionReason: { type: String, trim: true, maxlength: 1000, default: "" },
    messagingRestrictedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastSeenAt: { type: Date, default: null },
    onboarding: {
      version: { type: Number, default: 1 },
      status: { type: String, enum: ["not_started", "in_progress", "completed", "skipped"], default: "not_started" },
      currentStep: {
        type: String,
        enum: ["welcome", "interests", "instincts", "people", "light-your-world", "complete", "completed"],
        default: "welcome",
      },
      startedAt: { type: Date, default: null },
      welcomeCompleted: { type: Boolean, default: false },
      interestsCompleted: { type: Boolean, default: false },
      instinctsCompleted: { type: Boolean, default: false },
      peopleCompleted: { type: Boolean, default: false },
      checklistAcknowledged: { type: Boolean, default: false },
      skippedSteps: [{ type: String, maxlength: 60 }],
      completedAt: { type: Date, default: null },
      skippedAt: { type: Date, default: null },
    },
    onboardingChecklist: {
      watchedIntro: { type: Boolean, default: false },
      openedOrbit: { type: Boolean, default: false },
      openedStudio: { type: Boolean, default: false },
      createdFirstPost: { type: Boolean, default: false },
      sharedFirstStory: { type: Boolean, default: false },
      createdFirstWorld: { type: Boolean, default: false },
      followedFirstPeople: { type: Boolean, default: false },
      reactedToStory: { type: Boolean, default: false },
      visitedWorld: { type: Boolean, default: false },
      completedProfile: { type: Boolean, default: false },
      dismissedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      rewardGrantedAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) {
    next();
    return;
  }

  if (!this.isNew) {
    this.passwordChangedAt = new Date(Date.now() - 1000);
  }

  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.password);
};

userSchema.methods.passwordChangedAfter = function passwordChangedAfter(jwtIssuedAt) {
  if (!this.passwordChangedAt || !jwtIssuedAt) return false;
  return Math.floor(this.passwordChangedAt.getTime() / 1000) > jwtIssuedAt;
};

userSchema.index({ role: 1, status: 1, creatorApprovalStatus: 1 });
userSchema.index({ username: 1, status: 1 });
userSchema.index({ name: 1, status: 1 });

const User = mongoose.model("User", userSchema);

export default User;
