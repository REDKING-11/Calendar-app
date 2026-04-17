const DEFAULT_COUNTRY_OPTIONS = [
  { countryCode: 'US', name: 'United States' },
  { countryCode: 'CA', name: 'Canada' },
  { countryCode: 'GB', name: 'United Kingdom' },
  { countryCode: 'AU', name: 'Australia' },
  { countryCode: 'FI', name: 'Finland' },
  { countryCode: 'DE', name: 'Germany' },
  { countryCode: 'FR', name: 'France' },
  { countryCode: 'SE', name: 'Sweden' },
  { countryCode: 'NO', name: 'Norway' },
  { countryCode: 'DK', name: 'Denmark' },
  { countryCode: 'NL', name: 'Netherlands' },
  { countryCode: 'ES', name: 'Spain' },
  { countryCode: 'IT', name: 'Italy' },
  { countryCode: 'IE', name: 'Ireland' },
  { countryCode: 'PT', name: 'Portugal' },
  { countryCode: 'PL', name: 'Poland' },
  { countryCode: 'CH', name: 'Switzerland' },
  { countryCode: 'AT', name: 'Austria' },
  { countryCode: 'BE', name: 'Belgium' },
  { countryCode: 'JP', name: 'Japan' },
  { countryCode: 'CN', name: 'China' },
  { countryCode: 'IN', name: 'India' },
  { countryCode: 'BR', name: 'Brazil' },
  { countryCode: 'MX', name: 'Mexico' },
  { countryCode: 'NZ', name: 'New Zealand' },
  { countryCode: 'ZA', name: 'South Africa' },
];

const COUNTRY_TIMEZONE_MAP = {
  AE: ['Asia/Dubai'],
  AR: ['America/Argentina/Buenos_Aires'],
  AT: ['Europe/Vienna'],
  AU: [
    'Australia/Perth',
    'Australia/Darwin',
    'Australia/Adelaide',
    'Australia/Brisbane',
    'Australia/Hobart',
    'Australia/Melbourne',
    'Australia/Sydney',
  ],
  BD: ['Asia/Dhaka'],
  BE: ['Europe/Brussels'],
  BG: ['Europe/Sofia'],
  BR: [
    'America/Rio_Branco',
    'America/Boa_Vista',
    'America/Manaus',
    'America/Cuiaba',
    'America/Porto_Velho',
    'America/Belem',
    'America/Fortaleza',
    'America/Recife',
    'America/Sao_Paulo',
  ],
  CA: [
    'America/St_Johns',
    'America/Halifax',
    'America/Toronto',
    'America/Winnipeg',
    'America/Regina',
    'America/Edmonton',
    'America/Vancouver',
    'America/Whitehorse',
  ],
  CH: ['Europe/Zurich'],
  CL: ['America/Santiago'],
  CN: ['Asia/Shanghai', 'Asia/Urumqi'],
  CZ: ['Europe/Prague'],
  DE: ['Europe/Berlin'],
  DK: ['Europe/Copenhagen'],
  EE: ['Europe/Tallinn'],
  EG: ['Africa/Cairo'],
  ES: ['Europe/Madrid', 'Atlantic/Canary'],
  FI: ['Europe/Helsinki'],
  FR: ['Europe/Paris'],
  GB: ['Europe/London'],
  GH: ['Africa/Accra'],
  GR: ['Europe/Athens'],
  HR: ['Europe/Zagreb'],
  HU: ['Europe/Budapest'],
  ID: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'],
  IE: ['Europe/Dublin'],
  IL: ['Asia/Jerusalem'],
  IN: ['Asia/Kolkata'],
  IS: ['Atlantic/Reykjavik'],
  IT: ['Europe/Rome'],
  JP: ['Asia/Tokyo'],
  KE: ['Africa/Nairobi'],
  KR: ['Asia/Seoul'],
  LT: ['Europe/Vilnius'],
  LV: ['Europe/Riga'],
  MX: [
    'America/Cancun',
    'America/Merida',
    'America/Mexico_City',
    'America/Monterrey',
    'America/Chihuahua',
    'America/Ojinaga',
    'America/Mazatlan',
    'America/Tijuana',
  ],
  MY: ['Asia/Kuala_Lumpur', 'Asia/Kuching'],
  NG: ['Africa/Lagos'],
  NL: ['Europe/Amsterdam'],
  NO: ['Europe/Oslo'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham'],
  PH: ['Asia/Manila'],
  PK: ['Asia/Karachi'],
  PL: ['Europe/Warsaw'],
  PT: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'],
  RO: ['Europe/Bucharest'],
  RS: ['Europe/Belgrade'],
  RU: [
    'Europe/Kaliningrad',
    'Europe/Moscow',
    'Europe/Samara',
    'Asia/Yekaterinburg',
    'Asia/Omsk',
    'Asia/Krasnoyarsk',
    'Asia/Irkutsk',
    'Asia/Yakutsk',
    'Asia/Vladivostok',
    'Asia/Sakhalin',
    'Asia/Magadan',
    'Asia/Kamchatka',
  ],
  SA: ['Asia/Riyadh'],
  SE: ['Europe/Stockholm'],
  SG: ['Asia/Singapore'],
  SI: ['Europe/Ljubljana'],
  SK: ['Europe/Bratislava'],
  TH: ['Asia/Bangkok'],
  TR: ['Europe/Istanbul'],
  UA: ['Europe/Kyiv'],
  US: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
  ],
  VN: ['Asia/Ho_Chi_Minh'],
  ZA: ['Africa/Johannesburg'],
};

export function detectCountryCode() {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || '';

    if (typeof Intl.Locale === 'function' && locale) {
      const region = new Intl.Locale(locale).region;
      if (region) {
        return region.toUpperCase();
      }
    }

    const parts = locale.split('-');
    const region = parts[parts.length - 1];
    return /^[A-Za-z]{2}$/.test(region || '') ? region.toUpperCase() : '';
  } catch {
    return '';
  }
}

export function getDefaultCountryOptions(detectedCountryCode = '') {
  if (!detectedCountryCode) {
    return DEFAULT_COUNTRY_OPTIONS;
  }

  const matchedCountry = DEFAULT_COUNTRY_OPTIONS.find(
    (country) => country.countryCode === detectedCountryCode
  );

  return matchedCountry
    ? DEFAULT_COUNTRY_OPTIONS
    : [
        { countryCode: detectedCountryCode, name: detectedCountryCode },
        ...DEFAULT_COUNTRY_OPTIONS,
      ];
}

export function mergeCountryOptions(primary = [], fallback = DEFAULT_COUNTRY_OPTIONS) {
  const merged = new Map();

  for (const country of [...primary, ...fallback]) {
    if (!country?.countryCode || !country?.name) {
      continue;
    }

    merged.set(country.countryCode, {
      countryCode: country.countryCode,
      name: country.name,
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function getCountryTimezones(countryCode, supportedTimeZones = []) {
  if (!countryCode) {
    return supportedTimeZones;
  }

  const mappedTimeZones = COUNTRY_TIMEZONE_MAP[countryCode] || [];
  if (mappedTimeZones.length === 0) {
    return supportedTimeZones;
  }

  const supportedSet = new Set(supportedTimeZones);
  const filtered = mappedTimeZones.filter((timeZone) => supportedSet.has(timeZone));
  return filtered.length > 0 ? filtered : supportedTimeZones;
}

export function hasCountryTimezoneMapping(countryCode) {
  return Boolean(countryCode && COUNTRY_TIMEZONE_MAP[countryCode]?.length);
}
