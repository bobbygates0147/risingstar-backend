const MUSIC_TASK_PROFILES = [
  ['DGK Preview', 'Amuly feat. Aerozen', 'Romanian trap preview'],
  ['Relatie cu Bancnotele', 'Azteca', 'Official street single'],
  ['Indonesia Sayang: Cyber Disco Remix', 'Cyber Disco Indonesia', 'Bass-boosted party remix'],
  ['Jakarta Live Set: Opening Sequence', 'DJ CREAM', 'Indonesian hits live set'],
  ['Jakarta Live Set: Night Market Cut', 'DJ CREAM', 'Festival crowd energy'],
  ['Jakarta Live Set: Neon Bridge', 'DJ CREAM', 'Club transition mix'],
  ['Jakarta Live Set: Golden Hour Drop', 'DJ CREAM', 'High-tempo dance blend'],
  ['Jakarta Live Set: Radio Heat', 'DJ CREAM', 'Pop-dance throwback'],
  ['Jakarta Live Set: Afterparty Loop', 'DJ CREAM', 'Late-night house rotation'],
  ['Jakarta Live Set: Skyline Run', 'DJ CREAM', 'Peak-hour live mix'],
  ['Jakarta Live Set: Streetlight Encore', 'DJ CREAM', 'Crowd-ready remix pass'],
  ['Jakarta Live Set: Final Flash', 'DJ CREAM', 'Closing-room energy'],
  ['Jakarta Live Set: Downtown Pulse', 'DJ CREAM', 'Dancefloor reset'],
  ['Jakarta Live Set: Metro Groove', 'DJ CREAM', 'Live remix selection'],
  ['Jakarta Live Set: Sunrise Break', 'DJ CREAM', 'Melodic live blend'],
  ['Jakarta Live Set: Signal Boost', 'DJ CREAM', 'Radio-ready club mix'],
  ['Jakarta Live Set: Rush Hour', 'DJ CREAM', 'High-energy city mix'],
  ['Jakarta Live Set: Encore Edit', 'DJ CREAM', 'Live set highlight'],
  ['Jakarta Live Set: Warehouse Cut', 'DJ CREAM', 'Underground dance mix'],
  ['Jakarta Live Set: Mainstage Edit', 'DJ CREAM', 'Festival anthem blend'],
  ['Jakarta Live Set: Full Circle', 'DJ CREAM', 'Classic hits live set'],
  ['Do You Remember Me: Tape One', 'Indie Playlist Select', 'Dreamy indie playlist'],
  ['Do You Remember Me: Window Seat', 'Indie Playlist Select', 'Soft-focus indie rotation'],
  ['Do You Remember Me: Static Bloom', 'Indie Playlist Select', 'Lo-fi memory loop'],
  ['Do You Remember Me: Quiet Roads', 'Indie Playlist Select', 'Late-night indie mix'],
  ['Do You Remember Me: Blue Room', 'Indie Playlist Select', 'Bedroom-pop collection'],
  ['Do You Remember Me: Polaroid Fade', 'Indie Playlist Select', 'Nostalgic indie queue'],
  ['Do You Remember Me: Cassette Weather', 'Indie Playlist Select', 'Warm analog playlist'],
  ['Do You Remember Me: Original Playlist', 'Indie Playlist Select', 'Curated indie session'],
  ['Do You Remember Me: Extended Playlist', 'Indie Playlist Select', 'Indie discovery set'],
  ['Global Underground 026: Romania CD2 Cut 1', 'Global Underground', 'Progressive underground mix'],
  ['Global Underground 026: Romania CD2 Cut 2', 'Global Underground', 'Deep club sequence'],
  ['Global Underground 026: Romania CD2 Cut 3', 'Global Underground', 'Afterhours progressive set'],
  ['Global Underground 026: Romania CD2 Cut 4', 'Global Underground', 'Underground travel mix'],
  ['Global Underground 026: Romania CD2', 'Global Underground', 'Classic club journey'],
  ['Giulesti Crangasi', 'RAVA', 'Official street video cut'],
].map(([title, artist, mood]) => ({ title, artist, mood }));

const AD_TASK_PROFILES = [
  ['Ten-Second Product Teaser', 'Sponsor Studio', 'Fast brand recall spot'],
  ['Air Asia Billboard Motion Spot', 'Air Asia', 'Travel campaign clip'],
  ['Business Success Formula', 'Growth Campaign Studio', 'Small-business promo'],
  ['Go Good Drinks Product Film', 'Go Good Drinks', 'Cinematic beverage spot'],
  ['FileBox Storage Box Spot', 'FileBox', 'Home organization promo'],
  ['Clean Car Safety Reminder', 'Auto Care Sponsor', 'Public safety product tip'],
  ['Pandiyar Kudil Grocery Promo', 'Pandiyar Kudil', 'Online grocery campaign'],
  ['Rubic Business Loans', 'Rubic', 'Financial services promo'],
  ['Skin Care Product Commercial', 'Beauty Campaign Studio', 'Beauty product showcase'],
  ['Doritos Sling Baby Classic', 'Doritos', 'Snack brand commercial'],
  ['Soft Drink Motion Promo', 'Beverage Motion Studio', 'Animated drink campaign'],
  ['Vu Smart TV Feature Spot', 'Sysmantech', 'Consumer tech promo'],
  ['Vajra Wellness Video Brochure', 'Vajra Wellness', 'Wellness brand story'],
  ['Lifestyle Campaign Reel', 'Brand Motion Studio', 'Short sponsor reel'],
  ['Retail Launch Teaser', 'Commerce Creative Lab', 'Product awareness clip'],
  ['Digital Promo Highlight', 'Campaign Studio', 'Sponsored video highlight'],
  ['Coca-Cola Ten-Second Commercial', 'Coca-Cola', 'Soft drink brand spot'],
  ['Wheels & Miles Transport Promo', 'Wheels & Miles', 'Employee transport campaign'],
  ['Winworth Financial Services', 'Winworth Groups', 'Finance brand campaign'],
  ['World No Tobacco Day PSA', 'Public Health Campaign', 'Awareness message'],
].map(([title, artist, mood]) => ({ title, artist, mood }));

const artTitlePrefixes = [
  'Chromatic',
  'Velvet',
  'Signal',
  'Prism',
  'Museum',
  'Golden',
  'Gallery',
  'Afterglow',
  'Kinetic',
  'Solar',
  'Fragmented',
  'Electric',
  'Botanical',
  'Marble',
  'Surreal',
  'Vivid',
  'Silent',
  'Paper',
  'Neon',
  'Modern',
  'Luminous',
  'Analog',
  'Urban',
  'Celestial',
];

const artTitleSubjects = [
  'Drift',
  'Portrait',
  'Bloom',
  'Canvas',
  'Echo',
  'Relic',
  'Spectrum',
  'Vista',
  'Collage',
  'Horizon',
  'Gesture',
  'Atrium',
  'Pulse',
  'Mirage',
  'Fable',
  'Archive',
  'Myth',
  'Orbit',
  'Still Life',
  'Wall Study',
  'Garden',
  'Sculpture',
  'Monologue',
  'Reverie',
  'Field',
  'Glyph',
  'Sonata',
  'Ember',
  'Threshold',
];

const artArtistFirstNames = [
  'Mira',
  'Arlo',
  'Nia',
  'Kai',
  'Rumi',
  'Lio',
  'Ana',
  'Soren',
  'Elia',
  'Noor',
  'Tavi',
  'Iris',
  'Oren',
  'Mika',
  'Vera',
  'Levi',
];

const artArtistLastNames = [
  'Sol',
  'Muse',
  'Hart',
  'Dune',
  'Ash',
  'Voss',
  'Crest',
  'Vale',
  'Stone',
  'Ray',
  'Wren',
  'Ames',
  'Lark',
  'Reed',
  'Kade',
  'Morrow',
];

const artMoods = [
  'Curated visual drop',
  'Modern gallery post',
  'Abstract showcase',
  'Studio color study',
  'Concept portrait set',
  'Limited visual feature',
  'Collector spotlight',
  'Contemporary art like',
];

const legacyMusicArtists = new Set([
  'nova kade',
  'zuri vale',
  'ayr',
  'kairo',
  'juno redd',
  'ari moss',
  'nexus nine',
  'luna shore',
]);

const legacyArtArtists = new Set([
  'mira sol',
  'arlo muse',
  'nia hart',
  'kai dune',
  'rumi ash',
  'lio voss',
  'ana crest',
]);

function wrapIndex(index, length) {
  if (length <= 0 || !Number.isFinite(index) || index < 0) {
    return 0;
  }

  return Math.floor(index) % length;
}

function getProfile(profiles, index) {
  return profiles[wrapIndex(index, profiles.length)];
}

function getZeroBasedCatalogIndex(type, taskKey, fallbackTitle) {
  const source = `${taskKey || ''} ${fallbackTitle || ''}`;
  const patterns = {
    Music: [/music[-_ #]*(\d+)/i, /music\s+session[-_ #]*(\d+)/i, /track[-_ #]*(\d+)/i],
    Art: [/art[-_ #]*(\d+)/i, /art\s+session[-_ #]*(\d+)/i],
    Ads: [/ad[-_ #]*(\d+)/i, /sponsored\s+slot[-_ #]*(\d+)/i],
    Social: [/social[-_ #]*(\d+)/i, /follow[-_ #]*(\d+)/i],
  };

  for (const pattern of patterns[type] || []) {
    const match = pattern.exec(source);
    const parsed = Number.parseInt(match?.[1] || '', 10);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed - 1;
    }
  }

  return 0;
}

function isGenericTitle(type, title) {
  const normalized = String(title || '').trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  if (type === 'Music') {
    return /^(music|track|music session)(?:\s*[-_#]?\s*\d+)?$/.test(normalized);
  }

  if (type === 'Art') {
    return /^(art|artwork|art session)(?:\s*[-_#]?\s*\d+)?$/.test(normalized);
  }

  if (type === 'Social') {
    return /^(social|follow|join|social session)(?:\s*[-_#]?\s*\d+)?$/.test(normalized);
  }

  return /^(ad|ads|advert|advertisement|sponsored slot|sponsor slot|video)(?:\s*[-_#]?\s*\d+)?$/.test(
    normalized
  );
}

function isGenericArtist(artist) {
  const normalized = String(artist || '').trim().toLowerCase();

  return (
    !normalized ||
    normalized === 'artist' ||
    normalized === 'creator' ||
    normalized === 'uploader' ||
    normalized === 'unknown' ||
    normalized === 'unknown artist' ||
    normalized === 'unknown creator' ||
    normalized === 'brand partner'
  );
}

function isLegacyArtist(type, artist) {
  const normalized = String(artist || '').trim().toLowerCase();

  if (type === 'Music') {
    return legacyMusicArtists.has(normalized);
  }

  if (type === 'Art') {
    return legacyArtArtists.has(normalized);
  }

  return normalized === 'brand partner' || normalized === 'partner stack';
}

function getMusicCatalogProfile(index) {
  return getProfile(MUSIC_TASK_PROFILES, index);
}

function getAdCatalogProfile(index) {
  return getProfile(AD_TASK_PROFILES, index);
}

function getArtCatalogProfile(index) {
  const safeIndex = Math.max(Math.floor(Number.isFinite(index) ? index : 0), 0);

  return {
    title: `${artTitlePrefixes[wrapIndex(safeIndex, artTitlePrefixes.length)]} ${
      artTitleSubjects[wrapIndex(safeIndex * 7 + 3, artTitleSubjects.length)]
    }`,
    artist: `${artArtistFirstNames[wrapIndex(safeIndex * 5 + 2, artArtistFirstNames.length)]} ${
      artArtistLastNames[wrapIndex(safeIndex * 7 + 4, artArtistLastNames.length)]
    }`,
    mood: artMoods[wrapIndex(safeIndex * 3 + 1, artMoods.length)],
  };
}

function getTaskCatalogProfile(type, taskKey, fallbackTitle) {
  const index = getZeroBasedCatalogIndex(type, taskKey, fallbackTitle);

  if (type === 'Music') {
    return getMusicCatalogProfile(index);
  }

  if (type === 'Ads') {
    return getAdCatalogProfile(index);
  }

  if (type === 'Social') {
    return {
      title: `Social Follow ${index + 1}`,
      artist: 'Rising Star Social',
      mood: 'Follow or join partner channel',
    };
  }

  return getArtCatalogProfile(index);
}

function resolveTaskTitle(type, taskKey, fallbackTitle) {
  const cleanTitle = String(fallbackTitle || '').trim();

  if (!isGenericTitle(type, cleanTitle)) {
    return cleanTitle;
  }

  return getTaskCatalogProfile(type, taskKey, fallbackTitle).title;
}

function resolveTaskArtist(type, taskKey, fallbackTitle, fallbackArtist) {
  const cleanArtist = String(fallbackArtist || '').trim();
  const hasGenericTitle = isGenericTitle(type, fallbackTitle);

  if (!hasGenericTitle && !isGenericArtist(cleanArtist) && !isLegacyArtist(type, cleanArtist)) {
    return cleanArtist;
  }

  return getTaskCatalogProfile(type, taskKey, fallbackTitle).artist;
}

function resolveTaskMood(type, taskKey, fallbackTitle, fallbackMood) {
  const cleanMood = String(fallbackMood || '').trim();

  if (!isGenericTitle(type, fallbackTitle) && cleanMood) {
    return cleanMood;
  }

  return getTaskCatalogProfile(type, taskKey, fallbackTitle).mood;
}

module.exports = {
  getAdCatalogProfile,
  getArtCatalogProfile,
  getMusicCatalogProfile,
  resolveTaskArtist,
  resolveTaskMood,
  resolveTaskTitle,
};
