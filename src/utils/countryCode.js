const names = new Intl.DisplayNames(["en"], { type: "region" });
const normalize = value => String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
const codes = new Map();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b), name = names.of(code);
  if (name && name !== code) { codes.set(normalize(name), code); codes.set(code.toLowerCase(), code); }
}
for (const [alias, code] of Object.entries({ uae: "AE", uk: "GB", usa: "US", southkorea: "KR" })) codes.set(alias, code);
export const countryCode = value => codes.get(normalize(value)) || null;
export const countriesMatch = (a, b) => Boolean(a && b && (normalize(a) === normalize(b) || countryCode(a) && countryCode(a) === countryCode(b)));
