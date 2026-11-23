// Update legacy template prose without changing URLs, addresses or tokens.
export function brandCopy(value) {
  if (typeof value !== "string") return value;
  return value.split(/(https?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+|\{\{[^}]+\}\})/g).map((part, index) => index % 2 ? part : part
    .replace(/\b(?:onlyme|atseen)\b/gi, "@seen")
    .replace(/\bStars\b/g, "Coins").replace(/\bstars\b/g, "coins")
    .replace(/\bStar\b/g, "Coin").replace(/\bstar\b/g, "coin")
    .replace(/\bPlanets\b/g, "Worlds").replace(/\bplanets\b/g, "Worlds")
    .replace(/\bPlanet\b/g, "World").replace(/\bplanet\b/g, "World")
  ).join("");
}
