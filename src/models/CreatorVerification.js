import mongoose from "mongoose";

export const VERIFICATION_STATUSES = [
  "NOT_STARTED",
  "DRAFT",
  "PENDING_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
];

const documentMetadataSchema = new mongoose.Schema(
  {
    storageKey: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 1 },
    checksum: { type: String, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false }
);

const creatorVerificationSchema = new mongoose.Schema(
  {
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    status: { type: String, enum: VERIFICATION_STATUSES, default: "NOT_STARTED", index: true },
    legalFullName: { type: String, trim: true, default: "", maxlength: 150 },
    dateOfBirth: { type: Date, default: null },
    country: { type: String, trim: true, default: "", maxlength: 80, index: true },
    nationality: { type: String, trim: true, default: "", maxlength: 80 },
    address: { type: String, trim: true, default: "", maxlength: 300 },
    city: { type: String, trim: true, default: "", maxlength: 80 },
    phoneNumber: { type: String, trim: true, default: "", maxlength: 30 },
    documentType: {
      type: String,
      enum: ["national_id", "passport", "driver_license", "other", ""],
      default: "",
      index: true,
    },
    documentNumber: { type: String, trim: true, default: "", maxlength: 100 },
    issuingCountry: { type: String, trim: true, default: "", maxlength: 80 },
    expiryDate: { type: Date, default: null },
    documentFront: { type: documentMetadataSchema, default: null },
    documentBack: { type: documentMetadataSchema, default: null },
    selfieWithDocument: { type: documentMetadataSchema, default: null },
    ageConfirmed: { type: Boolean, default: false },
    informationConfirmed: { type: Boolean, default: false },
    policyAccepted: { type: Boolean, default: false },
    policyVersion: { type: String, trim: true, default: "", maxlength: 40 },
    acceptedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminInternalNote: { type: String, trim: true, default: "", maxlength: 2000 },
    creatorVisibleMessage: { type: String, trim: true, default: "", maxlength: 2000 },
    rejectionReason: { type: String, trim: true, default: "", maxlength: 1000 },
    changesRequestedReasons: [{ type: String, trim: true, maxlength: 200 }],
    legacyMigrated: { type: Boolean, default: false },
    legacyMigratedAt: { type: Date, default: null },
    stateSyncPending: { type: Boolean, default: false },
    stateSyncError: { type: String, default: "", maxlength: 1000 },
    lastTransitionId: { type: String, default: "", index: true },
  },
  { timestamps: true }
);

export default mongoose.model("CreatorVerification", creatorVerificationSchema);

