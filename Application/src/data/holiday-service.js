const Holidays = require('date-holidays');

const NAGER_BASE_URL = 'https://date.nager.at/api/v3';
const PUBLIC_HOLIDAY_TYPE = 'public';

function normalizeCountryCode(countryCode) {
  return String(countryCode || '').trim().toUpperCase();
}

function normalizeDateOnly(value) {
  return String(value || '').slice(0, 10);
}

function buildHolidayKey(holiday = {}) {
  return [
    normalizeDateOnly(holiday.date),
    String(holiday.type || '').toLowerCase(),
    String(holiday.rule || ''),
    String(holiday.name || ''),
  ].join('|');
}

function createDateHolidaysInstance(countryCode, timeZone) {
  const holidays = new Holidays(countryCode);
  if (timeZone && typeof holidays.setTimezone === 'function') {
    holidays.setTimezone(timeZone);
  }
  return holidays;
}

class HolidayService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  getAvailableCountries() {
    const countries = new Holidays().getCountries();

    return Object.entries(countries || {})
      .map(([countryCode, name]) => ({
        countryCode,
        name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getPublicHolidays({ countryCode, year, timeZone } = {}) {
    const normalizedCountryCode = normalizeCountryCode(countryCode);

    if (!normalizedCountryCode || !Number.isInteger(Number(year))) {
      return [];
    }

    try {
      const offlineHolidays = this.getOfflinePublicHolidays({
        countryCode: normalizedCountryCode,
        year: Number(year),
        timeZone,
      });

      if (offlineHolidays.length > 0) {
        return offlineHolidays;
      }
    } catch {
      // Fall back to Nager.Date when bundled holiday data is unavailable.
    }

    return this.getFallbackPublicHolidays({
      countryCode: normalizedCountryCode,
      year: Number(year),
    });
  }

  getOfflinePublicHolidays({ countryCode, year, timeZone }) {
    const localInstance = createDateHolidaysInstance(countryCode, timeZone);
    const englishInstance = createDateHolidaysInstance(countryCode, timeZone);

    if (typeof englishInstance.setLanguages === 'function') {
      englishInstance.setLanguages('en');
    }

    const localHolidays = Array.isArray(localInstance.getHolidays(year))
      ? localInstance.getHolidays(year)
      : [];
    const englishLookup = new Map(
      (Array.isArray(englishInstance.getHolidays(year)) ? englishInstance.getHolidays(year) : [])
        .filter((holiday) => String(holiday?.type || '').toLowerCase() === PUBLIC_HOLIDAY_TYPE)
        .map((holiday) => [buildHolidayKey(holiday), holiday.name])
    );

    return localHolidays
      .filter((holiday) => String(holiday?.type || '').toLowerCase() === PUBLIC_HOLIDAY_TYPE)
      .map((holiday) => {
        const normalizedDate = normalizeDateOnly(holiday.date || holiday.start?.toISOString?.());
        const localName = holiday.name || '';
        const englishName = englishLookup.get(buildHolidayKey(holiday)) || localName;

        return {
          date: normalizedDate,
          name: englishName || localName || 'Public holiday',
          localName: localName || englishName || 'Public holiday',
          countryCode,
          types: ['Public'],
          source: 'date-holidays',
        };
      })
      .filter((holiday) => holiday.date);
  }

  async getFallbackPublicHolidays({ countryCode, year }) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('No fetch implementation is available for holiday fallback.');
    }

    const response = await this.fetchImpl(
      `${NAGER_BASE_URL}/PublicHolidays/${year}/${countryCode}`
    );

    if (!response.ok) {
      throw new Error(`Holiday lookup failed with status ${response.status}.`);
    }

    const holidays = await response.json();

    return (Array.isArray(holidays) ? holidays : [])
      .filter((holiday) => {
        if (!Array.isArray(holiday?.types) || holiday.types.length === 0) {
          return true;
        }

        return holiday.types.some(
          (type) => String(type || '').toLowerCase() === PUBLIC_HOLIDAY_TYPE
        );
      })
      .map((holiday) => ({
        date: normalizeDateOnly(holiday.date),
        name: holiday.name || holiday.localName || 'Public holiday',
        localName: holiday.localName || holiday.name || 'Public holiday',
        countryCode,
        types:
          Array.isArray(holiday.types) && holiday.types.length > 0
            ? holiday.types
            : ['Public'],
        source: 'nager-date',
        subdivisionCodes: Array.isArray(holiday.counties)
          ? holiday.counties.filter(Boolean)
          : undefined,
      }))
      .filter((holiday) => holiday.date);
  }
}

module.exports = { HolidayService };
