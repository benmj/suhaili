// Static data for Suhaili: route, zones, landmarks, coastlines, rivals.
// Longitudes are "unwrapped": they keep increasing eastward from Falmouth
// (-5) round the world to Falmouth again (~355), so the route is one line.

export const START_DATE = Date.UTC(1968, 5, 14); // 14 June 1968
export const DAYS_PER_TURN = 4;
export const HISTORIC_DAYS = 312;

// [lon, lat, name?]
export const ROUTE = [
  [-5.07, 50.15, 'Falmouth'],
  [-9.5, 45.5],
  [-12, 40],
  [-17.5, 32.6, 'Madeira'],
  [-23, 20],
  [-25.5, 12],
  [-28, 3],
  [-28, -3, 'Equator'],
  [-31, -16],
  [-26, -28],
  [-10, -37],
  [5, -39],
  [18.4, -36.2, 'Cape of Good Hope'],
  [40, -41],
  [65, -44],
  [90, -43],
  [112, -37],
  [115.2, -36, 'Cape Leeuwin'],
  [130, -39],
  [146, -44, 'Tasmania'],
  [168, -48],
  [190, -51],
  [215, -55],
  [240, -57],
  [270, -57],
  [292.7, -56.2, 'Cape Horn'],
  [301, -52],
  [307, -46],
  [318, -34],
  [326, -18],
  [330, -3],
  [332, 4, 'Equator'],
  [333, 18],
  [332, 32],
  [337, 39, 'Azores'],
  [345, 46],
  [354.9, 50.15, 'Falmouth'],
];

// Great-circle-free: distances use a flat approximation, scaled so the whole
// route is ~30,000 nm like the real voyage.
const REAL_NM = 30123;

function seg(a, b) {
  const dx = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}
const rawLens = ROUTE.slice(1).map((p, i) => seg(ROUTE[i], p));
const rawTotal = rawLens.reduce((a, b) => a + b, 0);
const SCALE = REAL_NM / rawTotal;
export const SEG_NM = rawLens.map((l) => l * SCALE);
export const TOTAL_NM = REAL_NM;
export const CUM_NM = SEG_NM.reduce((acc, l) => (acc.push(acc[acc.length - 1] + l), acc), [0]);

export function pointAt(nm) {
  nm = Math.max(0, Math.min(TOTAL_NM, nm));
  let i = 0;
  while (i < SEG_NM.length - 1 && CUM_NM[i + 1] < nm) i++;
  const t = SEG_NM[i] ? (nm - CUM_NM[i]) / SEG_NM[i] : 0;
  const a = ROUTE[i], b = ROUTE[i + 1];
  return { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, seg: i };
}

// Named milestones along the route, in route-nm.
export const LANDMARKS = ROUTE.map((p, i) => ({ name: p[2], nm: CUM_NM[i], lon: p[0], lat: p[1] })).filter((m) => m.name);

// Sea zones by route-nm: wind odds are [calm, light, fresh, gale, storm] (percent).
export const ZONES = [
  { id: 'channel', name: 'Western Approaches', until: 1386, odds: [5, 25, 40, 25, 5], rain: 0.3, tropic: false },
  { id: 'trades_n', name: 'North-East Trades', until: 2900, odds: [8, 40, 45, 6, 1], rain: 0.2, tropic: true },
  { id: 'doldrums', name: 'The Doldrums', until: 4400, odds: [45, 35, 12, 6, 2], rain: 0.8, tropic: true },
  { id: 'trades_s', name: 'South-East Trades', until: 8400, odds: [6, 34, 50, 9, 1], rain: 0.2, tropic: true },
  { id: 'atlantic_s', name: 'South Atlantic', until: 9200, odds: [8, 30, 38, 20, 4], rain: 0.3, tropic: false },
  { id: 'forties', name: 'Roaring Forties', until: 17500, odds: [3, 12, 40, 33, 12], rain: 0.3, tropic: false },
  { id: 'fifties', name: 'Furious Fifties', until: 21000, odds: [2, 8, 32, 40, 18], rain: 0.3, tropic: false },
  { id: 'horn', name: 'Cape Horn Waters', until: 22500, odds: [1, 5, 24, 45, 25], rain: 0.3, tropic: false },
  { id: 'atlantic_n', name: 'Atlantic Homeward', until: 29000, odds: [6, 30, 42, 19, 3], rain: 0.3, tropic: false },
  { id: 'approaches', name: 'Western Approaches', until: 1e9, odds: [5, 25, 40, 25, 5], rain: 0.3, tropic: false },
];

export function zoneAt(nm) {
  return ZONES.find((z) => nm < z.until) || ZONES[ZONES.length - 1];
}

export const WIND_NAMES = ['Calm', 'Light airs', 'Fresh breeze', 'Gale', 'Storm'];

// Rivals of the 1968 Golden Globe Race, shown on the map and by radio.
// start: turn they cross the line; pace: route-nm per turn; out: {turn, text} when they leave the race.
export const RIVALS = [
  { id: 'ridgway', name: 'John Ridgway', color: '#ff8', start: -3, pace: 290, out: { turn: 8, text: 'John Ridgway has retired at the Azores: his boat is shaken to pieces.' } },
  { id: 'blyth', name: 'Chay Blyth', color: '#8f8', start: -2, pace: 300, out: { turn: 10, text: 'Chay Blyth has retired off South Africa: his boat is not strong enough for this.' } },
  { id: 'moitessier', name: 'Bernard Moitessier', color: '#f88', start: 19, pace: 520, out: { turn: 66, text: 'Moitessier has quit the race while leading it: he has turned east again for Tahiti, "to save my soul".' } },
  { id: 'tetley', name: 'Nigel Tetley', color: '#8cf', start: 24, pace: 400, out: { turn: 84, text: 'Nigel Tetley\'s trimaran has broken up in the Atlantic. He is in the liferaft.' } },
  { id: 'crowhurst', name: 'Donald Crowhurst', color: '#f8f', start: 42, pace: 260, out: { turn: 72, text: 'Donald Crowhurst\'s radio reports have stopped. His boat is found adrift, empty.' } },
];

export function rivalNm(r, turn) {
  const end = r.out ? Math.min(turn, r.out.turn) : turn;
  return Math.max(0, (end - r.start) * r.pace);
}

// ---- Coastlines (coarse, hand drawn; [lon, lat]). Drawn at -360, 0, +360. ----
export const LAND = [
  // Europe + Britain
  [[-9.5, 43], [-9, 38.7], [-6, 36.2], [-1, 37], [3, 42], [8, 44], [12, 38], [16, 40], [19, 41], [24, 38], [28, 41], [28, 46], [24, 54], [12, 55], [8, 57], [5, 62], [14, 68], [28, 71], [40, 68], [30, 60], [40, 60], [60, 70], [60, 40], [36, 36], [30, 31], [10, 33], [-6, 35.8], [-9.5, 43]],
  [[-6, 50], [-3, 50.3], [1.5, 51], [0, 53.5], [-2, 57.5], [-5, 58.5], [-6, 56], [-3, 54.5], [-5, 52], [-6, 50]],
  // Africa
  [[-17, 21], [-16.5, 13], [-13, 8], [-8, 4.5], [5, 5.5], [9, 3.5], [9, -2], [13, -9], [12, -17], [15, -27], [18.4, -34.2], [20, -34.8], [27, -33.5], [32.5, -28.5], [35.5, -23], [40, -15], [40.5, -10], [39.5, -4.5], [43, 0], [51, 11.8], [43, 12], [38, 18], [33, 28], [32.5, 31.3], [20, 32.5], [10, 37], [-1, 35.5], [-9.5, 32], [-13, 27.5], [-17, 21]],
  // Madagascar
  [[44, -25], [47, -25], [50, -15.5], [49.5, -12.2], [44, -16.5]],
  // Asia (rough, east of Suez to Pacific)
  [[36, 36], [60, 40], [60, 70], [100, 78], [140, 72], [180, 68], [170, 60], [140, 52], [130, 42], [122, 30], [120, 22], [108, 20], [106, 10], [100, 2], [98, 8], [93, 18], [80, 14], [78, 8], [72, 20], [66, 25], [57, 25.5], [56, 17], [44, 12.5], [38, 20], [34.5, 28], [35, 33], [36, 36]],
  // Australia
  [[114, -22], [122, -17.5], [130, -12.5], [136, -12], [136.5, -15], [141, -12.5], [143.5, -14], [146, -19], [153, -26], [153.5, -30], [150, -37.5], [146, -39], [140, -38], [136, -35], [131, -31.5], [124, -33.5], [117, -35], [115, -33], [114, -26]],
  // Tasmania
  [[144.7, -40.8], [148.3, -40.9], [148, -43.2], [146, -43.6], [145, -42]],
  // New Zealand
  [[172.7, -34.4], [175, -37], [178.5, -37.7], [175.5, -41.4], [174.8, -41], [173.5, -39.5]],
  [[172.5, -40.5], [174, -41.5], [172.7, -43.5], [170.8, -45.9], [168, -46.6], [166.4, -45.3], [170.5, -42.8]],
  // North America
  [[-168, 66], [-141, 70], [-95, 72], [-80, 68], [-62, 60], [-56, 52], [-66, 45], [-70, 42], [-76, 35], [-81, 31], [-80, 25], [-82, 28], [-90, 29.5], [-97, 27], [-97.5, 21], [-94, 18], [-87, 21.3], [-88, 16], [-83.5, 11], [-78, 8.5], [-80, 7.5], [-85, 10], [-92, 14.5], [-105, 20], [-110, 24], [-114, 31], [-117, 32.5], [-124, 40], [-124.5, 48], [-135, 58], [-150, 60], [-165, 60], [-168, 66]],
  // Greenland
  [[-52, 64], [-44, 60], [-40, 65], [-22, 70], [-20, 80], [-60, 82], [-72, 77], [-55, 69]],
  // South America
  [[-78, 8.5], [-72, 12], [-62, 10.5], [-52, 5], [-50, 0], [-44, -2.5], [-35, -5.5], [-35, -9], [-39, -14], [-40, -22], [-48, -26], [-53, -34], [-58, -38], [-62, -39], [-65, -45], [-68, -50], [-69, -52.5], [-68, -55], [-64, -54.8], [-71, -54], [-75, -50], [-74, -42], [-72.5, -30], [-70.5, -18], [-76, -13], [-81, -5], [-80, 0], [-77.5, 3.5]],
  // Antarctica (a strip, drawn as one band)
  [[-60, -71], [-20, -72], [30, -69], [80, -67], [140, -66.5], [200, -73], [240, -72], [270, -70], [300, -66], [300, -90], [-60, -90]],
];

export const ACHIEVEMENTS = [
  { id: 'madeira', label: 'Left Europe behind', nm: 'Madeira' },
  { id: 'equator1', label: 'Crossed the Line', nm: 'Equator' },
  { id: 'goodhope', label: 'Cape of Good Hope', nm: 'Cape of Good Hope' },
  { id: 'leeuwin', label: 'Cape Leeuwin', nm: 'Cape Leeuwin' },
  { id: 'horn', label: 'Cape Horn', nm: 'Cape Horn' },
  { id: 'home', label: 'Home to Falmouth', nm: 'Falmouth' },
];
