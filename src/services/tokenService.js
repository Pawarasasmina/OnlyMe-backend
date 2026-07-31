import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import RefreshSession from "../models/RefreshSession.js";
import { generateAccessToken, generateRefreshToken } from "../utils/generateToken.js";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenId() {
  return crypto.randomBytes(24).toString("hex");
}

function accessPayload(user) {
  return {
    sub: user._id.toString(),
    role: user.role,
  };
}

function refreshPayload(user, familyId, jti) {
  return {
    sub: user._id.toString(),
    jti,
    familyId,
  };
}

export function issueAccessToken(user) {
  return generateAccessToken(accessPayload(user));
}

export async function issueRefreshSession(user, familyId = tokenId()) {
  const jti = tokenId();
  const refreshToken = generateRefreshToken(refreshPayload(user, familyId, jti));
  const decoded = jwt.decode(refreshToken);

  await RefreshSession.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    tokenId: jti,
    familyId,
    expiresAt: new Date(decoded.exp * 1000),
  });

  return {
    refreshToken,
    tokenId: jti,
    familyId,
  };
}

export async function issueAuthTokens(user) {
  const refreshSession = await issueRefreshSession(user);

  return {
    accessToken: issueAccessToken(user),
    refreshToken: refreshSession.refreshToken,
  };
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) {
    return;
  }

  await RefreshSession.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function revokeAllUserRefreshSessions(userId) {
  await RefreshSession.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

export async function validateRefreshSession(refreshToken, decoded) {
  const currentSession = await RefreshSession.findOne({
    tokenHash: hashToken(refreshToken),
    tokenId: decoded.jti,
    user: decoded.sub,
  });

  if (!currentSession || currentSession.revokedAt || currentSession.expiresAt <= new Date()) {
    const knownSession = currentSession || await RefreshSession.findOne({ tokenId: decoded.jti });
    if (knownSession?.familyId) {
      await RefreshSession.updateMany(
        { familyId: knownSession.familyId, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }
    return null;
  }

  return currentSession;
}

export async function rotateRefreshSession(currentSession, user) {
  const revoked = await RefreshSession.updateOne(
    { _id: currentSession._id, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );

  if (revoked.modifiedCount !== 1) {
    return null;
  }

  const nextSession = await issueRefreshSession(
    user,
    currentSession.familyId
  );

  await RefreshSession.updateOne(
    { _id: currentSession._id },
    { $set: { replacedByTokenId: nextSession.tokenId } }
  );

  return nextSession.refreshToken;
}
