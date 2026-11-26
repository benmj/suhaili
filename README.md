# Suhaili

- **Purpose:** A turn-based solo sailing game after Robin Knox-Johnston's 1968-69 non-stop circumnavigation. Playable on a phone or desktop, with optional sign-in to keep a voyage across devices.
- **Design:**
  - One turn is 4 days; a voyage is about 80 turns (historic time: 312 days, 30,123 nm).
  - Set sail plan, rations and a watch task, then sail on. Events (weather, gear, wildlife, radio news) ask for decisions.
  - Rivals from the Golden Globe race appear on the chart with their 1968 fates.
  - Pure, seeded engine (`public/engine.js`): the whole game state is JSON, so saves are deterministic.
  - Zero-build front end (ES modules). Zero-dependency Node server for sign-in and saves.
- **Documents:** this README. No board or deck yet.

## Run

```
npm test        # engine tests
npm run sim     # balance simulation (bot win rate)
MAIL_DEV=1 npm start   # http://localhost:8110, sign-in links print to the log
```

## Server

- Static files plus `/api/*` and `/auth/*`.
- Sign-in: Google (authorization code with PKCE) or an emailed one-time link (Brevo HTTPS API).
- Sessions are signed HttpOnly cookies. One saved voyage per account, plus a history of finished voyages.
- Guests play from localStorage. On sign-in the newer of the local and server save wins.

## Configuration

Set in the environment or `~/.config/suhaili/secrets.env`; nothing secret is in the repo.

- `BASE_URL`, `PORT`, `DATA_DIR`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect URI `<BASE_URL>/auth/google/callback`)
- `BREVO_API_KEY`, `MAIL_FROM`
- `MAIL_DEV=1` logs the link instead of sending (development only)

## Licence

MIT. Dramatised from *A World of My Own*.
