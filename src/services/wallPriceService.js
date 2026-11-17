import ApiError from "../utils/ApiError.js";
import { currencyOfWallLocation } from "../constants/wallCurrency.js";
export const wallCurrencyOfLocation = currencyOfWallLocation;
export function readWallPrice(value, postType, location, countryCode = "") {
  if (value == null || (typeof value === "string" && !value.trim())) return { price: null, currency: "" };
  if (postType !== "Buy & Sell") throw new ApiError(400, "Prices are available for Buy & Sell notes");
  const raw = typeof value === "string" ? value.trim() : String(value);
  if (!["string", "number"].includes(typeof value) || !/^\d{1,9}$/.test(raw) || !Number.isSafeInteger(Number(value)) || Number(value) > 999999999) throw new ApiError(400, "Enter a whole-number price from 0 to 999999999");
  const currency = currencyOfWallLocation(location, countryCode);
  if (!currency) throw new ApiError(400, "Choose a note country to set its currency");
  return { price: Number(value), currency };
}
