# Upcoming Concerts

A simple, no-build web app that shows your upcoming concerts, organized by month, with date, time, venue, and address.

## Running it

No build step or server required — just open `index.html` in a browser. If your browser blocks local scripts, serve it with any static server, e.g.:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## How the concert list is built

This app doesn't call the Gmail/Calendar APIs directly from the browser (that would require setting up OAuth). Instead, the concert list in `js/data.js` is a snapshot: Claude scanned Gmail and Google Calendar and hand-picked events that represent an actual concert you're going to, using two signals:

- **Ticket purchase confirmations** — order confirmation emails from ticket vendors (Etix, Ticketmaster, AXS, StubHub, Eventbrite, etc.), not onsale alerts, newsletters, or "recommended for you" marketing emails.
- **Calendar events you were added to** — confirmed calendar entries for a show, with a venue/location and (usually) a ticket link in the description.

Sports, theater, comedy, and non-music events were excluded, as were past shows and events you were only ever *offered* tickets to.

### Searching for a show

Click **Search shows** at the top of the page. This searches the [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/) directly from your browser — it works regardless of whether you actually have a ticket, unlike the Gmail/Calendar-sourced list below it.

You'll need a free Ticketmaster API key:

1. Go to <https://developer.ticketmaster.com/products-and-docs/apis/getting-started/> and sign up (free).
2. Copy your **Consumer Key**.
3. Paste it into the "Ticketmaster API key" field in the app. It's saved in `localStorage` in that browser only — it's never sent anywhere except to Ticketmaster.

Search by artist/show name, city, or both — city-only (e.g. just "Portland") returns whatever music events Ticketmaster has there. Results show name, date, time, and venue, each with a **+ Add** button. Adding one saves it the same way as a manual entry (see below), including its own correct time zone (a show search finds isn't necessarily in Pacific time the way the venues Claude found in your Gmail are).

Your API key is saved as you type — no need to click away from the field first — so once entered it should still be there next time you open the app in that browser.

**This only works when the app is actually reaching the internet from your browser** — running it locally (as above) or hosting it somewhere with normal outbound network access (e.g. GitHub Pages) works fine. It will *not* work on a Claude-hosted artifact link, since those run in a sandbox that blocks requests to arbitrary external sites. If you want a shareable hosted link where search actually works, ask Claude to enable GitHub Pages for this repo.

One more honest caveat: this was built and tested with a mocked Ticketmaster response, since the sandbox Claude builds in can't reach the real Ticketmaster API either. If searching throws a network error against the *real* API, tell Claude — it's most likely a CORS restriction on Ticketmaster's end, which would need a small proxy to work around.

### Adding a concert manually

Click **+ Add manually** at the top of the page and fill in the artist, date, time, venue, and (optionally) address. Enter the time as Pacific time — that's the time zone all the venues Claude found are in. Manually added and searched-and-added concerts are both saved in your browser's `localStorage`, mixed in with the rest of the list, and show an **×** button so you can remove them. They only live in the browser you added them from — they aren't written back to `js/data.js` and won't show up if you open the app on another device.

### Refreshing the list after buying a ticket

Three ways, depending on how much you want Claude involved:

1. **Fastest — search for it.** Use **Search shows** above (needs a Ticketmaster API key, see above).
2. **Fast, no API key — add it yourself.** Use **+ Add manually** above.
3. **Durable — ask Claude to add it.** Tell Claude what you bought (or just say "rescan my Gmail for new concert tickets"), and ask it to add the entry to `concerts/js/data.js` and commit the change. This is the only version that persists in the repo and shows up everywhere, including in a freshly republished artifact link — options 1 and 2 are both local to one browser.

If you're using the hosted artifact link Claude gave you rather than running this repo yourself, **+ Add manually** works the same way there — it's the same page, just published as a standalone file. **Search shows** does not work there (see above). Baked-in concerts (the ones Claude found in Gmail/Calendar) can only be removed by asking Claude to edit `js/data.js`, since they're not stored in `localStorage`.
