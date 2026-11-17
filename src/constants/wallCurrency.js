// Country codes are the stable source; names and city aliases support older notes.
const groups = {
  AED: 'AE', SAR: 'SA', QAR: 'QA', KWD: 'KW', BHD: 'BH', OMR: 'OM', USD: 'US EC SV PA TL FM MH PW',
  EUR: 'AD AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MC ME MT NL PT SI SK SM VA',
  GBP: 'GB', CAD: 'CA', AUD: 'AU KI NR TV', CHF: 'CH LI', JPY: 'JP', THB: 'TH', IDR: 'ID', INR: 'IN', LKR: 'LK',
  PLN: 'PL', TRY: 'TR', GEL: 'GE', KZT: 'KZ', UAH: 'UA', SGD: 'SG', NZD: 'NZ', CNY: 'CN', HKD: 'HK', TWD: 'TW',
  KRW: 'KR', MYR: 'MY', PHP: 'PH', VND: 'VN', PKR: 'PK', BDT: 'BD', NPR: 'NP', MVR: 'MV', NOK: 'NO', SEK: 'SE',
  DKK: 'DK', ISK: 'IS', CZK: 'CZ', HUF: 'HU', RON: 'RO', BGN: 'BG', RSD: 'RS', ALL: 'AL', BAM: 'BA', MKD: 'MK',
  MDL: 'MD', RUB: 'RU', BYN: 'BY', AZN: 'AZ', AMD: 'AM', UZS: 'UZ', KGS: 'KG', TJS: 'TJ', TMT: 'TM',
  ILS: 'IL', JOD: 'JO', LBP: 'LB', IQD: 'IQ', IRR: 'IR', EGP: 'EG', MAD: 'MA', TND: 'TN', DZD: 'DZ', LYD: 'LY',
  ZAR: 'ZA', NGN: 'NG', KES: 'KE', GHS: 'GH', TZS: 'TZ', UGX: 'UG', RWF: 'RW', ETB: 'ET', MUR: 'MU', SCR: 'SC',
  XOF: 'BJ BF CI GW ML NE SN TG', XAF: 'CM CF TD CG GQ GA', BRL: 'BR', MXN: 'MX', ARS: 'AR', CLP: 'CL', COP: 'CO',
  PEN: 'PE', UYU: 'UY', PYG: 'PY', BOB: 'BO', CRC: 'CR', GTQ: 'GT', HNL: 'HN', NIO: 'NI', DOP: 'DO', JMD: 'JM',
  TTD: 'TT', BBD: 'BB', BSD: 'BS', XCD: 'AG DM GD KN LC VC', FJD: 'FJ', XPF: 'PF NC WF', KHR: 'KH', LAK: 'LA',
  BIF: 'BI', CDF: 'CD', CVE: 'CV', DJF: 'DJ', ERN: 'ER', GMD: 'GM', GNF: 'GN', KMF: 'KM', LRD: 'LR', LSL: 'LS', MGA: 'MG', MRU: 'MR', MWK: 'MW', SLE: 'SL', SOS: 'SO', SSP: 'SS', STN: 'ST', SZL: 'SZ', SDG: 'SD', YER: 'YE', SYP: 'SY', BZD: 'BZ', CUP: 'CU', HTG: 'HT', SRD: 'SR', GYD: 'GY', VES: 'VE', BMD: 'BM', KYD: 'KY', AWG: 'AW', ANG: 'CW SX', BTN: 'BT', KPW: 'KP', PGK: 'PG', SBD: 'SB', TOP: 'TO', VUV: 'VU', WST: 'WS', SHP: 'SH', FKP: 'FK', GIP: 'GI',
  MMK: 'MM', BND: 'BN', MNT: 'MN', AFN: 'AF', BWP: 'BW', NAD: 'NA', ZMW: 'ZM', MZN: 'MZ', AOA: 'AO',
};
const currencies = new Map();
const names = new Map();
for (const [currency, codes] of Object.entries(groups)) for (const code of codes.split(' ')) currencies.set(code, currency);
const normalize = value => String(value || '').trim().toLocaleLowerCase().normalize('NFKC');
for (const locale of ['en', 'ar', 'de', 'es', 'fr', 'pt', 'ru', 'uk']) {
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  for (const code of currencies.keys()) names.set(normalize(regions.of(code)), code);
}
for (const [name, code] of Object.entries({ UAE: 'AE', UK: 'GB', USA: 'US', 'United States of America': 'US', Turkey: 'TR' })) names.set(normalize(name), code);
const cities = { dubai: 'AE', 'abu dhabi': 'AE', london: 'GB', 'new york': 'US', miami: 'US', paris: 'FR', milan: 'IT', rome: 'IT', barcelona: 'ES', madrid: 'ES', lisbon: 'PT', porto: 'PT', warsaw: 'PL', tokyo: 'JP', bangkok: 'TH', bali: 'ID', colombo: 'LK' };
export function currencyOfWallLocation(location = '', countryCode = '') {
  if (countryCode) return currencies.get(String(countryCode).trim().toUpperCase()) || '';
  const parts = String(location || '').split(',').map(normalize).filter(Boolean);
  const country = parts.at(-1);
  const code = names.get(country) || (country?.length === 2 ? country.toUpperCase() : '');
  if (code) return currencies.get(code) || '';
  // A city-only legacy location may be resolved; an unknown country must never be guessed.
  return parts.length === 1 ? currencies.get(cities[parts[0]]) || '' : '';
}
