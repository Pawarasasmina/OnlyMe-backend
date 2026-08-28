export const VOICE_TRANSLATION_MAX_TEXT_LENGTH = 2000;

export const LARA_SUPPORTED_TRANSLATION_LANGUAGES = [
  { code: "ace-ID", name: "Acehnese" },
  { code: "af-ZA", name: "Afrikaans" },
  { code: "ak-GH", name: "Akan" },
  { code: "sq-AL", name: "Albanian" },
  { code: "am-ET", name: "Amharic" },
  { code: "ar-SA", name: "Arabic" },
  { code: "hy-AM", name: "Armenian" },
  { code: "as-IN", name: "Assamese" },
  { code: "ast-ES", name: "Asturian" },
  { code: "awa-IN", name: "Awadhi" },
  { code: "quy-PE", name: "Ayacucho Quechua" },
  { code: "az-AZ", name: "Azerbaijani" },
  { code: "ban-ID", name: "Balinese" },
  { code: "bm-ML", name: "Bambara" },
  { code: "bjn-ID", name: "Banjar" },
  { code: "ba-RU", name: "Bashkir" },
  { code: "eu-ES", name: "Basque" },
  { code: "be-BY", name: "Belarusian" },
  { code: "bem-ZM", name: "Bemba" },
  { code: "bn-BD", name: "Bengali" },
  { code: "bho-IN", name: "Bhojpuri" },
  { code: "bs-BA", name: "Bosnian" },
  { code: "bug-ID", name: "Buginese" },
  { code: "bg-BG", name: "Bulgarian" },
  { code: "my-MM", name: "Burmese" },
  { code: "ca-ES", name: "Catalan" },
  { code: "ceb-PH", name: "Cebuano" },
  { code: "tzm-MA", name: "Central Atlas Tamazight" },
  { code: "ayr-BO", name: "Central Aymara" },
  { code: "knc-NG", name: "Central Kanuri" },
  { code: "hne-IN", name: "Chhattisgarhi" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "zh-HK", name: "Chinese (Traditional, Hong Kong)" },
  { code: "cjk-AO", name: "Chokwe" },
  { code: "crh-RU", name: "Crimean Tatar" },
  { code: "hr-HR", name: "Croatian" },
  { code: "cs-CZ", name: "Czech" },
  { code: "da-DK", name: "Danish" },
  { code: "prs-AF", name: "Dari" },
  { code: "diq-TR", name: "Dimli" },
  { code: "dik-SS", name: "Dinka" },
  { code: "nl-NL", name: "Dutch" },
  { code: "nl-BE", name: "Dutch (Belgium)" },
  { code: "dyu-CI", name: "Dyula" },
  { code: "dz-BT", name: "Dzongkha" },
  { code: "en-AU", name: "English (Australia)" },
  { code: "en-CA", name: "English (Canada)" },
  { code: "en-IE", name: "English (Ireland)" },
  { code: "en-GB", name: "English (United Kingdom)" },
  { code: "en-US", name: "English" },
  { code: "eo-EU", name: "Esperanto" },
  { code: "et-EE", name: "Estonian" },
  { code: "ee-GH", name: "Ewe" },
  { code: "fo-FO", name: "Faroese" },
  { code: "fj-FJ", name: "Fijian" },
  { code: "fil-PH", name: "Filipino" },
  { code: "fi-FI", name: "Finnish" },
  { code: "fon-BJ", name: "Fon" },
  { code: "fr-FR", name: "French" },
  { code: "fr-CA", name: "French (Canada)" },
  { code: "fur-IT", name: "Friulian" },
  { code: "gl-ES", name: "Galician" },
  { code: "ka-GE", name: "Georgian" },
  { code: "de-DE", name: "German" },
  { code: "el-GR", name: "Greek" },
  { code: "gn-PY", name: "Guarani" },
  { code: "gu-IN", name: "Gujarati" },
  { code: "ht-HT", name: "Haitian Creole" },
  { code: "khk-MN", name: "Halh Mongolian" },
  { code: "ha-NE", name: "Hausa" },
  { code: "he-IL", name: "Hebrew" },
  { code: "hi-IN", name: "Hindi" },
  { code: "hu-HU", name: "Hungarian" },
  { code: "is-IS", name: "Icelandic" },
  { code: "ig-NG", name: "Igbo" },
  { code: "ilo-PH", name: "Iloko" },
  { code: "id-ID", name: "Indonesian" },
  { code: "ga-IE", name: "Irish" },
  { code: "it-IT", name: "Italian" },
  { code: "ja-JP", name: "Japanese" },
  { code: "jv-ID", name: "Javanese" },
  { code: "kac-MM", name: "Jingpho" },
  { code: "kbp-TG", name: "Kabiye" },
  { code: "kea-CV", name: "Kabuverdianu" },
  { code: "kab-DZ", name: "Kabyle" },
  { code: "kam-KE", name: "Kamba" },
  { code: "kn-IN", name: "Kannada" },
  { code: "kas-IN", name: "Kashmiri (Arabic script)" },
  { code: "ks-IN", name: "Kashmiri (Devanagari script)" },
  { code: "kk-KZ", name: "Kazakh" },
  { code: "km-KH", name: "Khmer" },
  { code: "ki-KE", name: "Kikuyu" },
  { code: "kmb-AO", name: "Kimbundu" },
  { code: "rw-RW", name: "Kinyarwanda" },
  { code: "rn-BI", name: "Kirundi" },
  { code: "kg-CG", name: "Kongo" },
  { code: "ko-KR", name: "Korean" },
  { code: "ckb-IQ", name: "Kurdish Sorani" },
  { code: "ky-KG", name: "Kyrgyz" },
  { code: "lo-LA", name: "Lao" },
  { code: "ltg-LV", name: "Latgalian" },
  { code: "la-VA", name: "Latin" },
  { code: "lv-LV", name: "Latvian" },
  { code: "lij-IT", name: "Ligurian" },
  { code: "li-NL", name: "Limburgish" },
  { code: "ln-CD", name: "Lingala" },
  { code: "lt-LT", name: "Lithuanian" },
  { code: "lmo-IT", name: "Lombard" },
  { code: "lua-CD", name: "Luba-Lulua" },
  { code: "lg-UG", name: "Luganda" },
  { code: "luo-KE", name: "Luo" },
  { code: "lb-LU", name: "Luxembourgish" },
  { code: "mk-MK", name: "Macedonian" },
  { code: "mag-IN", name: "Magahi" },
  { code: "mai-IN", name: "Maithili" },
  { code: "mg-MG", name: "Malagasy" },
  { code: "ms-MY", name: "Malay" },
  { code: "ml-IN", name: "Malayalam" },
  { code: "mt-MT", name: "Maltese" },
  { code: "mni-IN", name: "Manipuri" },
  { code: "mi-NZ", name: "Maori" },
  { code: "mr-IN", name: "Marathi" },
  { code: "min-ID", name: "Minangkabau" },
  { code: "lus-IN", name: "Mizo" },
  { code: "mn-MN", name: "Mongolian" },
  { code: "sr-ME", name: "Montenegrin" },
  { code: "mos-BF", name: "Mossi" },
  { code: "ne-NP", name: "Nepali" },
  { code: "fuv-NG", name: "Nigerian Fulfulde" },
  { code: "kmr-TR", name: "Northern Kurdish" },
  { code: "nso-ZA", name: "Northern Sotho" },
  { code: "nb-NO", name: "Norwegian Bokmal" },
  { code: "nus-SS", name: "Nuer" },
  { code: "ny-MW", name: "Nyanja" },
  { code: "oc-FR", name: "Occitan" },
  { code: "or-IN", name: "Odia" },
  { code: "pag-PH", name: "Pangasinan" },
  { code: "pap-CW", name: "Papiamento" },
  { code: "ps-PK", name: "Pashto" },
  { code: "fa-IR", name: "Persian" },
  { code: "plt-MG", name: "Plateau Malagasy" },
  { code: "pl-PL", name: "Polish" },
  { code: "pt-BR", name: "Portuguese (Brazil)" },
  { code: "pt-PT", name: "Portuguese (Portugal)" },
  { code: "pa-IN", name: "Punjabi" },
  { code: "ro-RO", name: "Romanian" },
  { code: "ru-RU", name: "Russian" },
  { code: "sm-WS", name: "Samoan" },
  { code: "sg-CF", name: "Sango" },
  { code: "sa-IN", name: "Sanskrit" },
  { code: "sat-IN", name: "Santali" },
  { code: "sc-IT", name: "Sardinian" },
  { code: "gd-GB", name: "Scottish Gaelic" },
  { code: "sr-Cyrl-RS", name: "Serbian (Cyrillic script)" },
  { code: "sr-Latn-RS", name: "Serbian (Latin script)" },
  { code: "shn-MM", name: "Shan" },
  { code: "sn-ZW", name: "Shona" },
  { code: "scn-IT", name: "Sicilian" },
  { code: "szl-PL", name: "Silesian" },
  { code: "sd-PK", name: "Sindhi" },
  { code: "si-LK", name: "Sinhala" },
  { code: "sk-SK", name: "Slovak" },
  { code: "sl-SI", name: "Slovenian" },
  { code: "so-SO", name: "Somali" },
  { code: "azb-AZ", name: "South Azerbaijani" },
  { code: "pbt-PK", name: "Southern Pashto" },
  { code: "st-LS", name: "Southern Sotho" },
  { code: "es-ES", name: "Spanish" },
  { code: "es-AR", name: "Spanish (Argentina)" },
  { code: "es-419", name: "Spanish (Latin America)" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "su-ID", name: "Sundanese" },
  { code: "sw-KE", name: "Swahili" },
  { code: "ss-SZ", name: "Swati" },
  { code: "sv-SE", name: "Swedish" },
  { code: "tl-PH", name: "Tagalog" },
  { code: "tg-TJ", name: "Tajik" },
  { code: "taq-ML", name: "Tamasheq" },
  { code: "ta-IN", name: "Tamil" },
  { code: "tt-RU", name: "Tatar" },
  { code: "te-IN", name: "Telugu" },
  { code: "th-TH", name: "Thai" },
  { code: "bo-CN", name: "Tibetan" },
  { code: "ti-ET", name: "Tigrinya" },
  { code: "tpi-PG", name: "Tok Pisin" },
  { code: "als-AL", name: "Tosk Albanian" },
  { code: "ts-ZA", name: "Tsonga" },
  { code: "tn-ZA", name: "Tswana" },
  { code: "tum-MW", name: "Tumbuka" },
  { code: "tr-TR", name: "Turkish" },
  { code: "tk-TM", name: "Turkmen" },
  { code: "tw-GH", name: "Twi" },
  { code: "uk-UA", name: "Ukrainian" },
  { code: "umb-AO", name: "Umbundu" },
  { code: "ur-PK", name: "Urdu" },
  { code: "ug-CN", name: "Uyghur" },
  { code: "uzn-UZ", name: "Uzbek" },
  { code: "vec-IT", name: "Venetian" },
  { code: "vi-VN", name: "Vietnamese" },
  { code: "war-PH", name: "Waray" },
  { code: "cy-GB", name: "Welsh" },
  { code: "gaz-ET", name: "West Central Oromo" },
  { code: "vls-BE", name: "West Flemish" },
  { code: "wo-SN", name: "Wolof" },
  { code: "xh-ZA", name: "Xhosa" },
  { code: "ydd-US", name: "Yiddish" },
  { code: "yo-NG", name: "Yoruba" },
  { code: "zu-ZA", name: "Zulu" },
];

const defaultLocaleByBaseLanguage = new Map([
  ["en", "en-US"],
  ["es", "es-ES"],
  ["fr", "fr-FR"],
  ["pt", "pt-BR"],
  ["zh", "zh-CN"],
  ["nl", "nl-NL"],
  ["de", "de-DE"],
]);

const languageByLookupCode = new Map(
  LARA_SUPPORTED_TRANSLATION_LANGUAGES.flatMap((language) => {
    const base = language.code.split("-")[0].toLowerCase();
    return [
      [language.code.toLowerCase(), language],
      [base, defaultLocaleByBaseLanguage.get(base) === language.code ? language : null],
    ].filter(([, entry]) => entry);
  })
);

function normalizeLookupCode(value) {
  return String(value || "").trim().replace(/_/g, "-").toLowerCase();
}

function canonicalizeLocaleLikeCode(value) {
  const parts = String(value || "").trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (!parts.length) return "";
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (/^\d+$/.test(part)) return part;
      if (part.length === 4) return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`;
      return part.toUpperCase();
    })
    .join("-");
}

export function resolveSupportedVoiceLanguage(value, languages = LARA_SUPPORTED_TRANSLATION_LANGUAGES) {
  const lookup = normalizeLookupCode(value);
  if (!lookup || lookup === "auto") return null;

  const configured = languageByLookupCode.get(lookup);
  if (configured && languages.some((language) => language.code === configured.code)) return configured;

  const direct = languages.find((language) => language.code.toLowerCase() === lookup);
  if (direct) return direct;

  const defaultLocale = defaultLocaleByBaseLanguage.get(lookup);
  if (defaultLocale) return languages.find((language) => language.code === defaultLocale) || null;

  return null;
}

export function normalizeVoiceLanguageCode(value) {
  const supported = resolveSupportedVoiceLanguage(value);
  if (supported) return supported.code;
  return canonicalizeLocaleLikeCode(value);
}

export function getVoiceLanguageName(value) {
  const supported = resolveSupportedVoiceLanguage(value);
  return supported?.name || String(value || "").trim();
}
