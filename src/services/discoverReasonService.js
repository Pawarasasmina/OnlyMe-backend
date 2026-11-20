// Match the prototype's stable per-person variation using verified facts only.
export function discoverCardReason({ id = "", dream, savedSeen, city, viewerCity, activeStatus, followedBy = [], now = Date.now() }) {
  let hash = 0;
  for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const reasons = [];
  if (dream?.title && dream.status === "active") reasons.push({ code: "DREAM", title: dream.title });
  if (savedSeen?.saveCount >= 500) reasons.push({ code: "SEEN_SAVED", count: savedSeen.saveCount });
  if (city && viewerCity && city.trim().toLowerCase() === viewerCity.trim().toLowerCase()) reasons.push({ code: "SAME_CITY", city });
  if (activeStatus?.isActive && (!activeStatus.expiresAt || new Date(activeStatus.expiresAt).getTime() > now) &&
      String(activeStatus.label || "").trim().toLowerCase() === "at seen") reasons.push({ code: "ACTIVE_NOW" });
  const people = followedBy.filter(person => person.id && (person.name || person.username)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (people.length) {
    const person = people[hash % people.length];
    reasons.push({ code: "FOLLOWED_BY", name: person.name?.split(" ")[0] || person.username });
  }
  return reasons.length ? reasons[hash % reasons.length] : { code: "DISCOVER_PROFILE" };
}
