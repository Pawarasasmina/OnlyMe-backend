import { generateAccessToken, generateRefreshToken } from "../utils/generateToken.js";

export function issueAuthTokens(user) {
  const payload = {
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
}
