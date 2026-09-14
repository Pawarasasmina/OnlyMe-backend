import ApiError from "../utils/ApiError.js";

const DEFAULT_PHOTON_URL = "https://photon.komoot.io";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cleanCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function compact(parts) {
  return [...new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))];
}

export function serializePhotonFeature(feature = {}) {
  const properties = feature.properties || {};
  const [longitude, latitude] = feature.geometry?.coordinates || [];
  const name = properties.name || properties.street || properties.city || properties.state || properties.country || "Location";
  const detailParts = compact([
    properties.housenumber && properties.street ? `${properties.housenumber} ${properties.street}` : properties.street,
    properties.district,
    properties.city,
    properties.state,
    properties.country,
  ]).filter((part) => part.toLowerCase() !== String(name).toLowerCase());
  const label = compact([name, ...detailParts]).join(", ");

  return {
    code: String(properties.countrycode || "").toUpperCase(),
    id: `${properties.osm_type || "place"}-${properties.osm_id || `${latitude}-${longitude}`}`,
    kind: properties.osm_value || properties.osm_key || "place",
    label,
    latitude: cleanCoordinate(latitude, -90, 90),
    longitude: cleanCoordinate(longitude, -180, 180),
    name,
    subtitle: detailParts.join(", "),
  };
}

export async function searchLiveLocations({ language = "en", latitude, longitude, query }) {
  const q = String(query || "").trim().slice(0, 120);
  if (q.length < 2) return [];

  const lat = cleanCoordinate(latitude, -90, 90);
  const lon = cleanCoordinate(longitude, -180, 180);
  const cacheKey = `${q.toLowerCase()}|${language}|${lat ?? ""}|${lon ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.items;

  const baseUrl = String(process.env.PHOTON_BASE_URL || DEFAULT_PHOTON_URL).replace(/\/$/u, "");
  const url = new URL(`${baseUrl}/api`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "12");
  url.searchParams.set("lang", String(language || "en").split(/[-_]/u)[0].slice(0, 2));
  if (lat !== null && lon !== null) {
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "OnlyMe/1.0 location-search" },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new ApiError(503, "Live location search is temporarily unavailable");
  }
  if (!response.ok) throw new ApiError(503, "Live location search is temporarily unavailable");

  const payload = await response.json();
  const seen = new Set();
  const items = (payload.features || []).map(serializePhotonFeature).filter((item) => {
    const key = item.label.toLowerCase();
    if (!item.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  cache.set(cacheKey, { createdAt: Date.now(), items });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return items;
}
