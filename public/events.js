// Event deck. Each event: { id, title, text, zones?, weight, when?, once?, choices:[{label, hint, resolve(s, rnd)}] }
// resolve returns { fx, text, kind } where fx is applied by the engine (see applyEffects).
// Dramatised from Knox-Johnston's account in "A World of My Own", not a transcript.

const ok = (text, fx, kind = 'good') => ({ text, fx, kind });
const bad = (text, fx) => ({ text, fx, kind: 'bad' });
const info = (text, fx) => ({ text, fx, kind: 'info' });
const cont = (fn) => [{ label: 'Carry on', hint: '', resolve: fn }];

const ALL_SEA = ['channel', 'trades_n', 'doldrums', 'trades_s', 'atlantic_s', 'forties', 'fifties', 'horn', 'atlantic_n', 'approaches'];
const SOUTH = ['forties', 'fifties', 'horn'];
const TROPICS = ['trades_n', 'doldrums', 'trades_s'];

export const EVENTS = [
  {
    id: 'dolphins', weight: 6, zones: ALL_SEA,
    title: 'Dolphins at the bow',
    text: 'A pod of dolphins rides the bow wave for an hour. They are the best company you have had in weeks.',
    choices: cont(() => ok('The dolphins lift your spirits.', { morale: 6 })),
  },
  {
    id: 'flying_fish', weight: 5, zones: TROPICS,
    title: 'Flying fish on deck',
    text: 'At dawn the deck is scattered with flying fish that came aboard in the night.',
    choices: [
      { label: 'Fry them for breakfast', hint: '+food', resolve: () => ok('Fresh fish for breakfast. A feast.', { food: 5, morale: 3 }) },
      { label: 'Throw them back', hint: '', resolve: () => info('You toss them overboard. Waste, but you feel better for it.', { morale: 1 }) },
    ],
  },
  {
    id: 'cockroaches', weight: 4, zones: TROPICS,
    title: 'Cockroaches in the galley',
    text: 'The warm weather has brought out the cockroaches. They are into the stores.',
    choices: [
      { label: 'Wage war: spend a watch cleaning', hint: '-1 spare, saves food', resolve: (s) => (s.stores.spares > 0 ? ok('Clean again. You lose little.', { spares: -1, morale: -1 }, 'info') : bad('No spares to clean with. They eat well.', { food: -10 })) },
      { label: 'Ignore them', hint: 'lose food', resolve: () => bad('They have a feast on your biscuits.', { food: -12, morale: -2 }) },
    ],
  },
  {
    id: 'mildew', weight: 4, zones: ['trades_s', 'atlantic_s', 'doldrums', 'forties'],
    title: 'Damp below',
    text: 'Everything below is wet. A tin without a label is the only thing left that does not smell.',
    choices: cont(() => bad('Some stores spoil in the damp.', { food: -8, health: -2 })),
  },
  {
    id: 'whale', weight: 4, zones: ALL_SEA,
    title: 'A whale surfaces close by',
    text: 'A big whale blows twenty yards off the beam, then sounds right under the keel.',
    choices: [
      { label: 'Hold your course', hint: 'risk of a strike', resolve: (s, r) => (r() < 0.3 ? bad('A thump and a shudder. Planks are sprung.', { hull: -9, flags: { leak: true } }) : ok('She slides past. A lucky escape.', { morale: 3 }, 'info')) },
      { label: 'Bear away and lose speed', hint: 'safe, costs miles', resolve: () => info('You bear off. The whale blows once and is gone.', { nm: -45 }) },
    ],
  },
  {
    id: 'ship_passes', weight: 5, zones: ['channel', 'trades_n', 'trades_s', 'atlantic_s', 'atlantic_n', 'approaches'],
    title: 'A ship on the horizon',
    text: 'A freighter is steaming straight across your track. You have a signalling lamp, a flare and a radio, maybe.',
    choices: [
      { label: 'Signal for news', hint: 'morale, a risk of a fuss', resolve: (s) => ok('She dips her ensign. The crew wave and a bundle of papers drops on the deck.', { morale: 8, flags: {} }) },
      { label: 'Stay clear: you must not take help', hint: 'nothing', resolve: () => info('You let her pass. It is a lonely sort of pride.', { morale: -1 }) },
    ],
  },
  {
    id: 'sail_tear', weight: 7, zones: ALL_SEA,
    when: (s, w, o) => w >= 2 || o.sail === 'full',
    title: 'Mainsail splits',
    text: 'A crack like a gunshot. The mainsail has split along a seam from the leech.',
    choices: [
      { label: 'Stitch it now (a spare)', hint: '-1 spare, saves the rig', resolve: (s) => (s.stores.spares > 0 ? ok('You sit in the cockpit with a palm and needle and stitch it all day.', { spares: -1, rig: -2, morale: -1 }, 'info') : bad('You have no thread or canvas. It worsens.', { rig: -12 })) },
      { label: 'Run on under the headsail', hint: 'slow, rig wears', resolve: () => bad('You run on under a scrap of sail. The tear grows.', { rig: -9, nm: -90 }) },
    ],
  },
  {
    id: 'chafe', weight: 6, zones: ALL_SEA,
    when: (s, w) => w >= 2,
    title: 'Chafe on the halyard',
    text: 'The halyard is chafing through at the masthead. It will not last.',
    choices: [
      { label: 'Go aloft and replace it', hint: 'risky in a seaway', resolve: (s, r) => (r() < 0.25 ? bad('You are thrown against the mast and cut your head. The halyard is replaced.', { rig: 6, health: -14, spares: -1 }) : ok('Done, and no harm. You feel like a monkey on a stick.', { rig: 8, spares: -1 })) },
      { label: 'Leave it and watch it', hint: '', resolve: (s, r) => (r() < 0.45 ? bad('It parts in the night. The sail comes down on deck.', { rig: -14, nm: -60 }) : info('It holds. For now.')) },
    ],
  },
  {
    id: 'leak', weight: 6, zones: ALL_SEA,
    when: (s, w) => !s.flags.leak && (w >= 3 || s.ship.hull < 70),
    title: 'Water in the bilge',
    text: 'The bilge is filling faster than it should. Somewhere in the garboards the seams are weeping.',
    choices: [
      { label: 'Pump and find the leak', hint: 'costs a watch', resolve: (s, r) => (r() < 0.5 ? ok('You find and caulk it. The bilge dries out.', { health: -2 }) : bad('You pump for hours. It is still weeping.', { health: -4, flags: { leak: true } })) },
      { label: 'Pump and hope', hint: 'it will worsen', resolve: () => bad('It does not stop. You will have to deal with it.', { health: -2, flags: { leak: true } }) },
    ],
  },
  {
    id: 'vane_jam', weight: 4, zones: ALL_SEA,
    when: (s) => !s.flags.vaneLost && s.ship.vane < 80,
    title: 'Self-steering gear seized',
    text: 'The vane gear has stopped answering. A pin has worked loose.',
    choices: [
      { label: 'Lash it up over the stern', hint: 'risky, but saves the gear', resolve: (s, r) => (r() < 0.55 ? ok('You hang over the transom with a wrench and fix it.', { vane: 22, health: -3 }) : bad('A big sea nearly takes you with it. The gear survives, barely.', { vane: 8, health: -9 })) },
      { label: 'Steer by hand', hint: 'tiring', resolve: () => info('You steer by hand all night and sleep in the morning.', { health: -3, morale: -2 }) },
    ],
  },
  {
    id: 'radio_dead', weight: 3, zones: ALL_SEA,
    when: (s) => s.flags.radio && s.turn > 6,
    title: 'The radio dies',
    text: 'The set crackles and then goes dead. The batteries are flooded.',
    choices: cont(() => bad('No news from home now. You are on your own.', { morale: -5, flags: { radio: false } })),
  },
  {
    id: 'radio_back', weight: 3, zones: ALL_SEA,
    when: (s) => !s.flags.radio && s.stores.spares > 1,
    title: 'A dead radio in your hands',
    text: 'You take the set apart on the saloon table. It might be saved.',
    choices: [
      { label: 'Try to repair it', hint: '-1 spare', resolve: (s, r) => (r() < 0.45 ? ok('It crackles and the BBC comes in, loud and clear.', { spares: -1, morale: 8, flags: { radio: true } }) : bad('A dead loss. You have wasted a day.', { spares: -1, morale: -3 })) },
      { label: 'Leave it', hint: '', resolve: () => info('You put it back in the locker and forget it.') },
    ],
  },
  {
    id: 'sharks', weight: 3, zones: TROPICS,
    title: 'Sharks around the hull',
    text: 'A pair of big sharks follow Suhaili for a day, bumping her rudder.',
    choices: [
      { label: 'Try to catch one', hint: 'food, risk of injury', resolve: (s, r) => (r() < 0.4 ? ok('You land one and the meat keeps for a week.', { food: 14, morale: 4 }) : bad('It thrashes and tears your hand. You lose the line.', { health: -9 })) },
      { label: 'Leave them be', hint: '', resolve: () => info('They lose interest by evening.') },
    ],
  },
  {
    id: 'infection', weight: 4, zones: ALL_SEA,
    when: (s) => s.crew.health < 85,
    title: 'A boil on the arm',
    text: 'A salt-water boil on your arm has swollen to an angry red knob. You have a little penicillin in the medicine chest.',
    choices: [
      { label: 'Dose with penicillin', hint: 'health', resolve: () => ok('The boil comes to a head and drains. A week later you forget it.', { health: 8 }) },
      { label: 'Lance it and bind it', hint: 'risk', resolve: (s, r) => (r() < 0.5 ? ok('It heals clean.', { health: 4 }) : bad('It goes septic. You are feverish for days.', { health: -12 })) },
    ],
  },
  {
    id: 'birthday', weight: 3, zones: ALL_SEA, once: true,
    when: (s) => s.turn > 6,
    title: 'A tin of something good',
    text: 'You find a tin of fruit cake at the back of a locker. It is your mother\'s, labelled "Not before the Cape of Good Hope".',
    choices: [
      { label: 'Eat it now', hint: 'morale', resolve: () => ok('It tastes of home. You eat the lot.', { morale: 14, food: 3 }) },
      { label: 'Save it', hint: 'for the Cape', resolve: () => info('You put it back. Discipline.', { morale: 2 }) },
    ],
  },
  {
    id: 'whisky', weight: 3, zones: ALL_SEA, once: true,
    when: (s) => s.turn > 10 && s.crew.morale < 55,
    title: 'The bottle of whisky',
    text: 'You are low. A bottle of whisky rolls out of the locker.',
    choices: [
      { label: 'A dram, no more', hint: 'morale', resolve: () => ok('You take a dram and sit watching the stars.', { morale: 10 }) },
      { label: 'Drink it dry', hint: 'rough morning', resolve: () => bad('A fine evening and an awful morning. The ship sails on without you.', { morale: 6, health: -8, nm: -50 }) },
    ],
  },
  {
    id: 'squall', weight: 7, zones: ['doldrums', 'trades_n', 'trades_s'],
    title: 'Squall line',
    text: 'A black squall comes down out of the clear sky. The sails thunder.',
    choices: [
      { label: 'Douse the sails fast', hint: 'safe', resolve: () => info('You get the sail off in time. It passes in half an hour, with a deluge of rain.', { water: 22 }) },
      { label: 'Run before it', hint: 'fast and risky', resolve: (s, r) => (r() < 0.35 ? bad('She is knocked down and the rig takes a beating.', { rig: -10, hull: -4 }) : ok('You ride the squall for a good run.', { nm: 90, water: 12 }, 'good')) },
    ],
  },
  {
    id: 'doldrum_calm', weight: 5, zones: ['doldrums'],
    title: 'Not a breath of wind',
    text: 'For days the sails hang and the heat is like an oven. Tar bubbles in the deck seams.',
    choices: [
      { label: 'Row to find a breeze', hint: 'tiring', resolve: (s, r) => (r() < 0.4 ? ok('Her sweeps give you a few miles.', { nm: 40, health: -4 }) : bad('You gain nothing.', { health: -5 })) },
      { label: 'Wait, swim, read', hint: 'rest', resolve: () => info('You swim round the ship and read a book on the foredeck.', { morale: 3, health: 2 }) },
    ],
  },
  {
    id: 'knockdown', weight: 8, zones: SOUTH.concat(['atlantic_s', 'atlantic_n']),
    when: (s, w, o) => w >= 3 && o.sail !== 'hove',
    title: 'A huge breaking sea',
    text: 'A big comber rolls out of the dark, breaks over the stern and throws the ship on her beam ends.',
    choices: [
      { label: 'Hang on and check below', hint: '', resolve: (s, r) => {
        const sev = r();
        if (sev < 0.25) return bad('She rolls nearly all the way over. The mast stays but the hatch is stove in.', { rig: -12, hull: -9, food: -8, health: -8, flags: { }, spares: 0 });
        if (sev < 0.8) return bad('She comes up streaming. You have a cracked rib and a lot to dry.', { hull: -4, rig: -6, health: -7 });
        return info('She shakes it off and comes back up. You are very wet.', { hull: -2, rig: -2 });
      }, stat: 'knockdowns' },
    ],
  },
  {
    id: 'albatross', weight: 6, zones: SOUTH.concat(['atlantic_s']),
    title: 'An albatross keeps you company',
    text: 'A wandering albatross has been tracking you for two days, gliding along the wave faces without a wingbeat.',
    choices: cont(() => ok('You feel the ghost of the Ancient Mariner and sleep soundly.', { morale: 6 })),
  },
  {
    id: 'iceberg', weight: 5, zones: ['fifties', 'horn', 'forties'],
    when: (s) => s.nm > 17000 && s.nm < 24000,
    title: 'Ice ahead',
    text: 'A white shape stands out of the fog: an iceberg. There may be growlers around it.',
    choices: [
      { label: 'Alter course north', hint: 'safe, loses miles', resolve: () => info('You give it a wide berth and lose a day.', { nm: -120, morale: -1 }) },
      { label: 'Hold the course', hint: 'risk of collision', resolve: (s, r) => (r() < 0.2 ? bad('You hit a growler in the dark. The bow is stove in.', { hull: -16 }) : ok('You miss it by a hundred yards. Heart in mouth.', { morale: 2, nm: 30 }, 'info')) },
    ],
  },
  {
    id: 'pooped', weight: 7, zones: ['forties', 'fifties'],
    when: (s, w) => w >= 3,
    title: 'Surfing down the faces',
    text: 'The seas are enormous and well-spaced. Suhaili surfs down each face, with the wake white behind.',
    choices: [
      { label: 'Stream warps to slow her', hint: 'safer', resolve: () => info('You stream warps astern. She drags a little and rides easier.', { nm: -30, hull: 1 }) },
      { label: 'Let her run', hint: 'fast, risky', resolve: (s, r) => (r() < 0.3 ? bad('She broaches and the cockpit fills.', { hull: -6, rig: -6, health: -4 }) : ok('A wild ride. You cover a hundred miles before the seas ease.', { nm: 110, morale: 3 })) },
    ],
  },
  {
    id: 'sunny_day', weight: 5, zones: ['atlantic_s', 'forties', 'atlantic_n', 'trades_s', 'trades_n'],
    when: (s, w) => w <= 2,
    title: 'A fine day',
    text: 'For once the sun is out, the sea is gentle and you can hang everything out to dry.',
    choices: cont(() => ok('Everything dries and you do a clean-up. The cabin smells less like a swamp.', { morale: 5, health: 3, hull: 1 })),
  },
  {
    id: 'landfall_birds', weight: 4, zones: ['atlantic_n', 'approaches'],
    when: (s) => s.nm > 26000,
    title: 'Birds and flotsam',
    text: 'Gulls and gannets wheel around the masthead. There are pieces of wood in the water. Land cannot be far.',
    choices: cont(() => ok('You smell it: land, rain and wood smoke. Home is near.', { morale: 8 })),
  },
  {
    id: 'cold', weight: 4, zones: SOUTH,
    title: 'Hail and ice on the rigging',
    text: 'Hail hammers the deck and ice builds on the shrouds. Your hands are numb.',
    choices: [
      { label: 'Chip the ice off', hint: 'risky, tiring', resolve: () => bad('You work in the freezing dark and your fingers lose feeling.', { health: -7, rig: 4 }) },
      { label: 'Stay below', hint: 'ice builds', resolve: () => bad('The ice builds up and the ship is heavy and slow.', { rig: -6, nm: -40, morale: -2 }) },
    ],
  },
  {
    id: 'rudder', weight: 4, zones: ALL_SEA,
    when: (s, w) => w >= 3 && s.ship.hull < 80,
    title: 'The rudder shakes',
    text: 'There is a hammering from below the stern. One of the rudder pintles is working loose.',
    choices: [
      { label: 'Dive over to inspect', hint: 'risk of drowning', resolve: (s, r) => (r() < 0.2 ? bad('You are nearly swept away. The pintle is secured.', { hull: 4, health: -12, spares: -1 }) : ok('You find and drive a wedge. It holds.', { hull: 5, spares: -1 })) },
      { label: 'Leave it', hint: '', resolve: (s, r) => (r() < 0.4 ? bad('It fails in the next blow. You steer with a tiller on a board.', { hull: -8, nm: -80 }) : info('It holds.')) },
    ],
  },
];

// Fixed events at named places along the route (nm values from data.js landmarks)
export const MILESTONE_EVENTS = [
  {
    id: 'ms_goodhope', nm: 8518, weight: 1,
    title: 'The Cape of Good Hope',
    text: 'The first of the Great Capes lies north of you in the dark. The sea has turned a colder blue. Ahead lies the Southern Ocean.',
    choices: [
      { label: 'Eat your mother\'s cake', hint: 'morale', resolve: () => ok('You open the tin and eat the fruit cake with a mug of tea. It tastes of home.', { morale: 8, food: 2 }) },
      { label: 'Press on', hint: '', resolve: () => info('You press on. There is a long way to go yet.') },
    ],
  },
  {
    id: 'ms_tasmania', nm: 15479, weight: 1,
    title: 'Off Tasmania: a boat comes out',
    text: 'A small boat comes out from the Tasmanian coast. A man waves a camera: the press are out. You have film to give and mail for home.',
    choices: [
      { label: 'Hand over the film and mail', hint: 'allowed: you never touch land', resolve: () => ok('You pass your parcel across without touching the boat. A bag of fresh fruit sails past on a line. +morale.', { morale: 14, food: 6, water: 12 }) },
      { label: 'Wave them off', hint: 'the purist', resolve: () => info('You wave them off. The man shouts something about the news.', { morale: 2 }) },
    ],
  },
  {
    id: 'ms_horn', nm: 21662, weight: 1,
    title: 'Cape Horn',
    text: 'The great black rock stands out of the murk. A gale is blowing from the west. The Horn is your last great obstacle, and the most dangerous.',
    choices: [
      { label: 'Round close and fast', hint: 'saves miles, risks the ship', resolve: (s, r) => (r() < 0.4 ? bad('A huge sea takes her. She survives, but she pays for it.', { hull: -14, rig: -12, health: -8, nm: 100 }) : ok('You thread the gap between the rocks and the Diego Ramirez Islands. The Horn is behind you.', { nm: 140, morale: 12 })) },
      { label: 'Stand off to the south', hint: 'safe, loses time', resolve: () => info('You stay well out and miss the worst. You lose a day, but the ship is whole.', { nm: -30, morale: 6 }) },
    ],
  },
  {
    id: 'ms_azores', nm: 28944, weight: 1,
    title: 'Home waters ahead',
    text: 'The radio brings the Western Approaches forecast. A great crowd of boats is waiting off Falmouth.',
    choices: cont(() => ok('You put the kettle on. A few days now.', { morale: 10 })),
  },
];

export const EVENT_BY_ID = Object.fromEntries(EVENTS.concat(MILESTONE_EVENTS).map((e) => [e.id, e]));
