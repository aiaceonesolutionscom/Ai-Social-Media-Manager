// Normalization helpers that translate the conversational targeting shape
// (produced by the LLM in AdTargeting) into a valid Meta Ads API targeting spec.
// Keeps the country/city/interest/gender mapping logic in one tested place.

const COUNTRY_CODE: Record<string, string> = {
  pakistan: 'PK',
  'united states': 'US',
  us: 'US',
  america: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  england: 'GB',
  'united arab emirates': 'AE',
  uae: 'AE',
  dubai: 'AE',
  india: 'IN',
  canada: 'CA',
  australia: 'AU',
  germany: 'DE',
  france: 'FR',
  // Add more as needed; the key is lower-cased country name → ISO-3166 alpha-2.
}

const CITY_TO_COUNTRY: Record<string, string> = {
  karachi: 'PK',
  'new york': 'US',
  london: 'GB',
  dubai: 'AE',
  delhi: 'IN',
  mumbai: 'IN',
  toronto: 'CA',
}

export interface NormalizedGeo {
  countries: string[]
  cities: Array<{ name: string; country: string }>
}

export function normalizeLocations(locations: string[]): NormalizedGeo {
  const countries: string[] = []
  const cities: Array<{ name: string; country: string }> = []
  for (const loc of locations) {
    const key = loc.toLowerCase().trim()
    const countryCode = COUNTRY_CODE[key]
    if (countryCode) {
      countries.push(countryCode)
      continue
    }
    const cityCountry = CITY_TO_COUNTRY[key]
    if (cityCountry) {
      cities.push({ name: loc, country: cityCountry })
      continue
    }
    // Try to map a country name that the LLM may have returned verbatim.
    const matched = COUNTRY_CODE[key]
    if (matched) {
      countries.push(matched)
    } else if (loc.length === 2 && /^[A-Za-z]{2}$/.test(loc)) {
      // Already a 2-letter code.
      countries.push(loc.toUpperCase())
    } else {
      // Unknown location — fall back to the country derived from language/context
      // is handled by caller; here we just drop it to avoid a Meta API 100 error.
    }
  }
  return { countries, cities }
}

// Meta expects interests by ID (via the targeting search endpoint). Because we
// cannot call targeting search synchronously here, callers should resolve IDs
// upstream or omit interests that cannot be resolved. This helper safely
// filters to known-interest placeholders and returns IDs only when present.
export interface NormalizedInterest { id: string; name: string }
export function normalizeInterests(interests: string[], knownIds?: Record<string, string>): NormalizedInterest[] {
  if (!knownIds) return []
  return interests
    .map((name) => {
      const id = knownIds[name.toLowerCase().trim()]
      return id ? { id, name } : null
    })
    .filter((i): i is NormalizedInterest => i !== null)
}

// Meta genders: 1=male, 2=female. "all" means omit the field entirely.
export function normalizeGenders(genders: string[]): number[] | undefined {
  if (!genders || genders.length === 0) return undefined
  if (genders.includes('all') || genders.length === 0) return undefined
  const out: number[] = []
  for (const g of genders) {
    const key = g.toLowerCase().trim()
    if (key === 'male' || key === 'm') out.push(1)
    else if (key === 'female' || key === 'f') out.push(2)
  }
  return out.length > 0 ? out : undefined
}

export function buildMetaTargeting(t: {
  ageMin?: number
  ageMax?: number
  genders?: string[]
  locations?: string[]
  interests?: string[]
  interestIds?: Record<string, string>
}): Record<string, unknown> {
  const geo = normalizeLocations(t.locations || [])
  const genders = normalizeGenders(t.genders || [])
  const geoLocations: Record<string, unknown> = {}
  if (geo.countries.length > 0) geoLocations.countries = geo.countries
  if (geo.cities.length > 0) {
    geoLocations.cities = geo.cities.map((c) => ({ key: c.name, location_id: c.country }))
  }

  const targeting: Record<string, unknown> = {}
  if (t.ageMin) targeting.age_min = t.ageMin
  if (t.ageMax) targeting.age_max = t.ageMax
  if (genders) targeting.genders = genders
  if (Object.keys(geoLocations).length > 0) targeting.geo_locations = geoLocations

  const interests = normalizeInterests(t.interests || [], t.interestIds)
  // Only resolved, real Meta interest IDs are ever sent. Fabricating a
  // hardcoded interest (e.g. "Digital Marketing") would mis-target every
  // campaign, so unresolvable interest names are omitted — never guessed.
  if (interests.length > 0) {
    targeting.interests = interests
  }

  // Placements default to Facebook + Instagram feed.
  targeting.publisher_platforms = ['facebook', 'instagram']
  targeting.device_platforms = ['mobile', 'desktop']

  return targeting
}
