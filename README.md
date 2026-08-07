# Upcoming Concerts

A simple, no-build web app that shows your upcoming concerts, organized by month, with date, time, venue, and address.

## Running it

No build step or server required — just open `index.html` in a browser. If your browser blocks local scripts, serve it with any static server, e.g.:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

Sign in with Google to see or manage the list — manually-added and searched concerts, plus the Ticketmaster API key, are synced via Firebase/Firestore to any device signed in with the same Google account. Any Google account can sign in (not locked to one email), so you can share edit access with a friend by giving them the URL.

## How the concert list is built

This app doesn't call the Gmail/Calendar APIs directly from the browser (that would require setting up OAuth). Instead, the baked-in concert list in `js/data.js` is a snapshot: Claude scanned Gmail and Google Calendar and hand-picked events that represent an actual concert you're going to, using two signals:

- **Ticket purchase confirmations** — order confirmation emails from ticket vendors (Etix, Ticketmaster, AXS, StubHub, Eventbrite, etc.), not onsale alerts, newsletters, or "recommended for you" marketing emails.
- **Calendar events you were added to** — confirmed calendar entries for a show, with a venue/location and (usually) a ticket link in the description.

Sports, theater, comedy, and non-music events were excluded, as were past shows and events you were only ever *offered* tickets to.

Manually-added and searched concerts (see below) aren't baked into `js/data.js` — they live in Firestore and merge with the baked-in list at render time on every device you're signed in on.

### Searching for a show

Click **Search shows** at the top of the page. This searches the [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/) directly from your browser.

You'll need a free Ticketmaster API key:

1. Go to <https://developer.ticketmaster.com/products-and-docs/apis/getting-started/> and sign up (free).
2. Copy your **Consumer Key**.
3. Paste it into the "Ticketmaster API key" field in the app. It's synced to your Firebase account (not shared publicly — see "Sharing your list" below) so it follows you across devices once entered.

Search by artist/show name, city, or both — city-only (e.g. just "Portland") returns whatever music events Ticketmaster has there. Results show name, date, time, and venue, each with a **+ Add** button. Adding one closes the search panel, shows a confirmation toast, and adds it to the list with its own correct time zone (a show search finds isn't necessarily in Pacific time the way the venues Claude found in your Gmail are).

Your API key is saved as you type — no need to click away from the field first.

### Adding a concert manually

Click **+ Add manually** at the top of the page and fill in the artist, date, time, venue, and (optionally) address. Enter the time as Pacific time — that's the time zone all the venues Claude found are in. Manually added and searched-and-added concerts show an **×** button so you can remove them; baked-in concerts (the ones Claude found in Gmail/Calendar) can only be removed by asking Claude to edit `js/data.js`.

### Sharing your list

`share.html` (e.g. `https://concerts.christinedippold.com/share.html`) is a public, read-only, no-sign-in-required page that shows the same concert list — artist, date, and venue only — for sharing with friends. It updates live as you add or remove shows. It intentionally does not show your Ticketmaster API key or let visitors add/remove anything.

Under the hood, `appData/state` in Firestore (which holds the shared concert list) is publicly readable but only writable when signed in; the API key lives in a separate `appData/private` doc that's never publicly readable. See the Firestore security rules in the Firebase console if you need to double-check this.

### Refreshing the list after buying a ticket

Three ways, depending on how much you want Claude involved:

1. **Fastest — search for it.** Use **Search shows** above (needs a Ticketmaster API key, see above).
2. **Fast, no API key — add it yourself.** Use **+ Add manually** above.
3. **Durable — ask Claude to add it.** Tell Claude what you bought (or just say "rescan my Gmail for new concert tickets"), and ask it to add the entry to `js/data.js` and commit the change. This is the only version that's part of the baked-in snapshot rather than the live Firestore list — useful if you want an entry to survive even if the Firestore data were ever wiped.
