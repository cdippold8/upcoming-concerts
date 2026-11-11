(function () {
  const DEFAULT_TIME_ZONE = "America/Los_Angeles"; // used for baked-in data and the manual-add form
  // appData/state holds only `concerts` and is publicly readable (see
  // share.html) — the Ticketmaster API key must never live there, so it
  // gets its own owner-only doc.
  const STATE_DOC = db.collection("appData").doc("state");
  const PRIVATE_DOC = db.collection("appData").doc("private");
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // In-memory cache kept in sync with Firestore via onSnapshot below —
  // this is the single source of truth for manual/searched concerts and
  // the Ticketmaster API key, replacing the old localStorage-backed copy.
  let manualConcerts = [];
  let apiKeyValue = "";
  // "Who's going" data, keyed by attendanceKey(concert). Lives in the
  // signed-in-only appData/private doc so names and who-owes-whom never
  // reach the public share page.
  let attendance = {};
  // Which cards have their "Who's going" panel expanded. Local UI state only,
  // kept across re-renders so a Firestore update doesn't collapse the panel.
  const openAttendance = new Set();
  let listenerAttached = false;

  // Extracts a date's local date/time parts in a given IANA time zone,
  // independent of the viewer's own browser timezone.
  function zonedParts(d, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });
    const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
    return {
      year: Number(parts.year),
      month: Number(parts.month) - 1, // 0-indexed to match MONTH_NAMES
      day: Number(parts.day),
      weekday: parts.weekday,
      hour: parts.hour,
      minute: parts.minute,
      dayPeriod: parts.dayPeriod,
    };
  }

  // Converts a "wall clock" date + time, entered in the given time zone, into
  // the correct absolute instant (as an ISO string), regardless of the
  // viewer's own timezone or that zone's current UTC offset (DST vs not).
  function wallTimeToISOString(year, month, day, hour, minute, timeZone) {
    const guessUTC = Date.UTC(year, month, day, hour, minute);
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
    const offsetLabel = dtf.formatToParts(new Date(guessUTC)).find((p) => p.type === "timeZoneName").value;
    const match = offsetLabel.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    const sign = match[1] === "-" ? -1 : 1;
    const offsetMs = sign * (Number(match[2]) * 60 + Number(match[3] || 0)) * 60000;
    return new Date(guessUTC - offsetMs).toISOString();
  }

  function formatTime(p) {
    const minuteStr = p.minute === "00" ? "" : `:${p.minute}`;
    return `${p.hour}${minuteStr} ${p.dayPeriod}`;
  }

  // Days between two same-zone calendar dates (ignoring time-of-day).
  function daysBetween(a, b) {
    const utcA = Date.UTC(a.year, a.month, a.day);
    const utcB = Date.UTC(b.year, b.month, b.day);
    return Math.round((utcA - utcB) / 86400000);
  }

  function daysUntilLabel(days) {
    if (days < 0) return null;
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 14) return `In ${days} days`;
    if (days < 60) return `In ${Math.round(days / 7)} weeks`;
    return `In ${Math.round(days / 30)} months`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // --- Firestore-backed state -----------------------------------------------
  // Manual/searched concerts and the Ticketmaster API key live in a single
  // doc (appData/state) so they sync across every signed-in device.

  function loadManualConcerts() {
    return manualConcerts;
  }

  function addManualConcert(concert) {
    STATE_DOC.set({ concerts: firebase.firestore.FieldValue.arrayUnion(concert) }, { merge: true }).catch((err) => {
      console.error("Failed to add concert:", err);
    });
  }

  function removeManualConcert(id) {
    const concert = manualConcerts.find((c) => c.id === id);
    if (!concert) return;
    STATE_DOC.set({ concerts: firebase.firestore.FieldValue.arrayRemove(concert) }, { merge: true }).catch((err) => {
      console.error("Failed to remove concert:", err);
    });
  }

  // Baked-in concerts have no id, so fall back to the same date|venue key
  // used for de-duping search results.
  function attendanceKey(c) {
    return c.id || `baked:${dedupeKey(c)}`;
  }

  function getAttendance(c) {
    const entry = attendance[attendanceKey(c)] || {};
    return {
      people: Array.isArray(entry.people) ? entry.people : [],
      buyer: entry.buyer || "me",
      mePaid: Boolean(entry.mePaid),
    };
  }

  // Writes one concert's whole entry. With merge, the other concerts'
  // entries are left alone, and this entry's `people` array is replaced
  // wholesale (arrays aren't merged), which is what we want.
  function saveAttendance(c, entry) {
    const key = attendanceKey(c);
    attendance = { ...attendance, [key]: entry };
    render();
    PRIVATE_DOC.set({ attendance: { [key]: entry } }, { merge: true }).catch((err) => {
      console.error("Failed to save attendees:", err);
    });
  }

  function loadApiKey() {
    return apiKeyValue;
  }

  function saveApiKey(key) {
    PRIVATE_DOC.set({ apiKey: key }, { merge: true }).catch((err) => {
      console.error("Failed to save API key:", err);
    });
  }

  // Subscribes to the state docs; safe to call more than once thanks to the
  // listenerAttached guard, since onAuthStateChanged can fire again (e.g.
  // token refresh) without the user signing out and back in.
  function attachDataListener() {
    if (listenerAttached) return;
    listenerAttached = true;

    STATE_DOC.onSnapshot(
      (doc) => {
        const data = doc.data() || {};
        manualConcerts = data.concerts || [];
        render();

        // One-time migration: the API key used to live in this doc, back
        // before it was made publicly readable for share.html.
        if (data.apiKey) {
          PRIVATE_DOC.set({ apiKey: data.apiKey }, { merge: true })
            .then(() => STATE_DOC.update({ apiKey: firebase.firestore.FieldValue.delete() }))
            .catch((err) => console.error("Failed to migrate API key:", err));
        }
      },
      (err) => {
        console.error("Firestore listener error:", err);
      }
    );

    PRIVATE_DOC.onSnapshot(
      (doc) => {
        const data = doc.data() || {};
        apiKeyValue = data.apiKey || "";
        attendance = data.attendance || {};
        render();

        const keyInput = document.getElementById("tmApiKey");
        if (keyInput && document.activeElement !== keyInput) keyInput.value = apiKeyValue;
      },
      (err) => {
        console.error("Firestore listener error:", err);
      }
    );
  }

  // A rough "already on the list" key so re-adding the same search result
  // twice doesn't create a duplicate card.
  function dedupeKey(c) {
    return `${c.date}|${c.venue}`.toLowerCase();
  }

  function render() {
    const manual = loadManualConcerts();
    const allConcerts = [...CONCERTS, ...manual];
    const nowPartsDefault = zonedParts(new Date(), DEFAULT_TIME_ZONE);

    const upcoming = allConcerts
      .map((c) => {
        const timeZone = c.timeZone || DEFAULT_TIME_ZONE;
        const parts = zonedParts(new Date(c.date), timeZone);
        const nowParts = zonedParts(new Date(), timeZone);
        return { ...c, timeZone, parts, days: daysBetween(parts, nowParts) };
      })
      .filter((c) => c.days >= 0)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const root = document.getElementById("app");
    const summary = document.getElementById("summary");

    if (upcoming.length === 0) {
      summary.textContent = "No upcoming concerts found.";
      root.innerHTML = '<p class="empty">Nothing on the calendar right now — go buy some tickets.</p>';
      return;
    }

    summary.textContent = `${upcoming.length} upcoming concert${upcoming.length === 1 ? "" : "s"}`;

    const groups = new Map();
    for (const c of upcoming) {
      const key = `${c.parts.year}-${c.parts.month}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    root.innerHTML = "";
    for (const [key, concerts] of groups) {
      const [year, month] = key.split("-").map(Number);

      const section = document.createElement("section");
      section.className = "month-group";

      const heading = document.createElement("h2");
      heading.className = "month-heading";
      const isCurrentMonth = year === nowPartsDefault.year && month === nowPartsDefault.month;
      heading.textContent = `${MONTH_NAMES[month]} ${year}${isCurrentMonth ? " — this month" : ""}`;
      section.appendChild(heading);

      const list = document.createElement("div");
      list.className = "concert-list";

      for (const c of concerts) {
        const card = document.createElement("article");
        card.className = "concert-card";

        const badge = daysUntilLabel(c.days);
        const isManual = Boolean(c.id);

        card.innerHTML = `
          <div class="concert-date">
            <div class="concert-weekday">${c.parts.weekday}</div>
            <div class="concert-day">${c.parts.day}</div>
          </div>
          <div class="concert-info">
            <h3 class="concert-artist">${escapeHtml(c.artist)}</h3>
            <div class="concert-meta">
              <span class="concert-time">${formatTime(c.parts)}</span>
              <span class="concert-sep">·</span>
              <span class="concert-venue">${escapeHtml(c.venue)}</span>
            </div>
            ${c.address ? `<div class="concert-address">${escapeHtml(c.address)}</div>` : ""}
            <div class="concert-source">${escapeHtml(c.source)}</div>
            <div class="attendance"></div>
          </div>
          ${badge ? `<div class="concert-badge">${badge}</div>` : ""}
          ${isManual ? '<button type="button" class="concert-remove" title="Remove">&times;</button>' : ""}
        `;

        if (isManual) {
          card.querySelector(".concert-remove").addEventListener("click", () => removeManualConcert(c.id));
        }

        renderAttendance(card.querySelector(".attendance"), c);
        list.appendChild(card);
      }

      section.appendChild(list);
      root.appendChild(section);
    }
  }

  // --- Who's going ------------------------------------------------------
  // Per concert: who's coming, who bought the tickets (you or one of them),
  // and which non-buyers have paid the buyer back.

  function attendanceSummary(entry) {
    const going = entry.people.length + 1; // +1 for you
    const owing = [
      ...(entry.buyer === "me" ? [] : [{ paid: entry.mePaid }]),
      ...entry.people.filter((p) => p.name !== entry.buyer),
    ].filter((p) => !p.paid).length;
    if (entry.people.length === 0) return "Who\u2019s going";
    return `Who\u2019s going \u00b7 ${going}${owing ? ` \u00b7 ${owing} owe${owing === 1 ? "s" : ""}` : " \u00b7 all paid"}`;
  }

  function renderAttendance(container, c) {
    const key = attendanceKey(c);
    const entry = getAttendance(c);
    const isOpen = openAttendance.has(key);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "attendance-toggle";
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.textContent = `${isOpen ? "\u25be" : "\u25b8"} ${attendanceSummary(entry)}`;
    toggle.addEventListener("click", () => {
      if (openAttendance.has(key)) openAttendance.delete(key);
      else openAttendance.add(key);
      render();
    });
    container.appendChild(toggle);
    if (!isOpen) return;

    const panel = document.createElement("div");
    panel.className = "attendance-panel";

    const buyerName = entry.buyer === "me" ? "you" : entry.buyer;
    const rows = [{ name: "me", label: "You", paid: entry.mePaid, removable: false }].concat(
      entry.people.map((p) => ({ name: p.name, label: p.name, paid: Boolean(p.paid), removable: true }))
    );

    const list = document.createElement("ul");
    list.className = "attendance-list";
    for (const row of rows) {
      const li = document.createElement("li");
      li.className = "attendance-person";
      const isBuyer = row.name === entry.buyer;
      li.innerHTML = `
        <span class="attendance-name">${escapeHtml(row.label)}</span>
        ${
          isBuyer
            ? '<span class="attendance-buyer-tag">Bought tickets</span>'
            : `<label class="attendance-paid"><input type="checkbox" ${row.paid ? "checked" : ""} /> Paid ${escapeHtml(buyerName)} back</label>`
        }
        ${row.removable ? `<button type="button" class="attendance-remove" title="Remove ${escapeHtml(row.label)}" aria-label="Remove ${escapeHtml(row.label)}">&times;</button>` : ""}
      `;

      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.addEventListener("change", () => {
          if (row.name === "me") {
            saveAttendance(c, { ...entry, mePaid: checkbox.checked });
          } else {
            const people = entry.people.map((p) => (p.name === row.name ? { ...p, paid: checkbox.checked } : p));
            saveAttendance(c, { ...entry, people });
          }
        });
      }

      const removeBtn = li.querySelector(".attendance-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          const people = entry.people.filter((p) => p.name !== row.name);
          if (entry.buyer !== row.name) {
            saveAttendance(c, { ...entry, people });
          } else {
            // The buyer left, so tickets fall back to you and the old
            // paid-back checkmarks no longer mean anything.
            saveAttendance(c, { people: people.map((p) => ({ ...p, paid: false })), buyer: "me", mePaid: false });
          }
        });
      }

      list.appendChild(li);
    }
    panel.appendChild(list);

    if (entry.people.length > 0) {
      const buyerRow = document.createElement("label");
      buyerRow.className = "attendance-buyer";
      buyerRow.textContent = "Who bought the tickets? ";
      const select = document.createElement("select");
      for (const row of rows) {
        const opt = document.createElement("option");
        opt.value = row.name;
        opt.textContent = row.label;
        if (row.name === entry.buyer) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener("change", () => {
        // Paid-back checkmarks are relative to the old buyer, so start fresh.
        const people = entry.people.map((p) => ({ ...p, paid: false }));
        saveAttendance(c, { ...entry, buyer: select.value, people, mePaid: false });
      });
      buyerRow.appendChild(select);
      panel.appendChild(buyerRow);
    }

    const form = document.createElement("form");
    form.className = "attendance-add";
    form.innerHTML = `
      <input type="text" placeholder="Add a friend&rsquo;s name" aria-label="Friend&rsquo;s name" maxlength="60" />
      <button type="submit" class="add-toggle">Add</button>
    `;
    const input = form.querySelector("input");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const taken = name.toLowerCase() === "me" || name.toLowerCase() === "you" ||
        entry.people.some((p) => p.name.toLowerCase() === name.toLowerCase());
      if (taken) {
        input.setCustomValidity("That person is already on the list.");
        input.reportValidity();
        return;
      }
      saveAttendance(c, { ...entry, people: [...entry.people, { name, paid: false }] });
      // render() rebuilt the card; put the cursor back for adding the next name.
      const fresh = document.querySelector(`.attendance-add[data-key="${CSS.escape(key)}"] input`);
      if (fresh) fresh.focus();
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    form.dataset.key = key;
    panel.appendChild(form);

    container.appendChild(panel);
  }

  function setupAddForm() {
    const toggle = document.getElementById("addToggle");
    const form = document.getElementById("addForm");
    const cancel = document.getElementById("addCancel");

    toggle.addEventListener("click", () => {
      form.hidden = !form.hidden;
      toggle.textContent = form.hidden ? "+ Add manually" : "Cancel";
      if (!form.hidden) document.getElementById("fieldArtist").focus();
    });

    cancel.addEventListener("click", () => {
      form.reset();
      form.hidden = true;
      toggle.textContent = "+ Add manually";
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const artist = document.getElementById("fieldArtist").value.trim();
      const dateVal = document.getElementById("fieldDate").value; // YYYY-MM-DD
      const timeVal = document.getElementById("fieldTime").value; // HH:MM
      const venue = document.getElementById("fieldVenue").value.trim();
      const address = document.getElementById("fieldAddress").value.trim();

      if (!artist || !dateVal || !timeVal || !venue) return;

      const [year, month, day] = dateVal.split("-").map(Number);
      const [hour, minute] = timeVal.split(":").map(Number);

      addManualConcert({
        id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        artist,
        date: wallTimeToISOString(year, month - 1, day, hour, minute, DEFAULT_TIME_ZONE),
        venue,
        address,
        timeZone: DEFAULT_TIME_ZONE,
        source: "Added manually",
      });

      form.reset();
      form.hidden = true;
      toggle.textContent = "+ Add manually";
    });
  }

  // --- Ticketmaster Discovery API search -----------------------------------
  // Free API key: https://developer.ticketmaster.com/products-and-docs/apis/getting-started/
  // Runs entirely in the browser — nothing is sent anywhere but Ticketmaster.

  function existingKeys() {
    return new Set([...CONCERTS, ...loadManualConcerts()].map(dedupeKey));
  }

  function parseSearchResult(event) {
    const venue = event._embedded && event._embedded.venues && event._embedded.venues[0];
    const city = venue && venue.city ? venue.city.name : "";
    const state = venue && venue.state ? venue.state.stateCode : "";
    const line1 = venue && venue.address ? venue.address.line1 : "";
    const address = [line1, [city, state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
    const timeZone = (event.dates && event.dates.timezone) || DEFAULT_TIME_ZONE;
    const localDate = event.dates && event.dates.start && event.dates.start.localDate;
    const localTime = event.dates && event.dates.start && event.dates.start.localTime;

    return {
      name: event.name,
      venueName: venue ? venue.name : "Venue TBA",
      address,
      timeZone,
      localDate: localDate || null,
      localTime: localTime || null,
      url: event.url || "",
    };
  }

  function renderSearchResults(container, events, panel, toggle) {
    if (events.length === 0) {
      container.innerHTML = '<p class="search-status">No shows found for that search.</p>';
      return;
    }

    const already = existingKeys();
    container.innerHTML = "";

    for (const rawEvent of events) {
      const r = parseSearchResult(rawEvent);
      if (!r.localDate) continue; // skip events with no date announced yet

      const [y, m, d] = r.localDate.split("-").map(Number);
      const hasTime = Boolean(r.localTime);
      const [hh, mm] = hasTime ? r.localTime.split(":").map(Number) : [19, 0];
      const isoDate = wallTimeToISOString(y, m - 1, d, hh, mm, r.timeZone);

      const candidate = { date: isoDate, venue: r.venueName };
      const alreadyAdded = already.has(dedupeKey(candidate));

      const row = document.createElement("div");
      row.className = "search-result";
      row.innerHTML = `
        <div class="search-result-info">
          <div class="search-result-name">${escapeHtml(r.name)}</div>
          <div class="search-result-meta">${escapeHtml(r.localDate)}${hasTime ? ` &middot; ${escapeHtml(r.localTime.slice(0, 5))}` : " &middot; time TBA"} &middot; ${escapeHtml(r.venueName)}${r.address ? ` &mdash; ${escapeHtml(r.address)}` : ""}</div>
        </div>
        <button type="button" class="search-add-btn" ${alreadyAdded ? "disabled" : ""}>${alreadyAdded ? "Added" : "+ Add"}</button>
      `;

      const btn = row.querySelector(".search-add-btn");
      if (!alreadyAdded) {
        btn.addEventListener("click", () => {
          addManualConcert({
            id: `search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            artist: r.name,
            date: isoDate,
            venue: r.venueName,
            address: r.address,
            timeZone: r.timeZone,
            source: hasTime ? "Found via Ticketmaster search" : "Found via Ticketmaster search (time TBA)",
          });
          panel.hidden = true;
          toggle.textContent = "Search shows";
          showToast("Fuck yeah! Show added!");
        });
      }

      container.appendChild(row);
    }
  }

  async function runSearch(query, city, container, panel, toggle) {
    const key = loadApiKey();
    if (!key) {
      container.innerHTML = '<p class="search-status">Add your free Ticketmaster API key above first.</p>';
      return;
    }
    if (!query && !city) return;

    container.innerHTML = '<p class="search-status">Searching&hellip;</p>';

    let url = `https://app.ticketmaster.com/discovery/v2/events.json?classificationName=music&size=12&sort=date,asc&apikey=${encodeURIComponent(key)}`;
    if (query) url += `&keyword=${encodeURIComponent(query)}`;
    if (city) url += `&city=${encodeURIComponent(city)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const msg =
          res.status === 401 || res.status === 403
            ? "That API key was rejected — double-check you copied it correctly."
            : `Ticketmaster returned an error (status ${res.status}).`;
        container.innerHTML = `<p class="search-status search-status-error">${escapeHtml(msg)}</p>`;
        return;
      }
      const data = await res.json();
      const events = (data._embedded && data._embedded.events) || [];
      renderSearchResults(container, events, panel, toggle);
    } catch (err) {
      container.innerHTML =
        '<p class="search-status search-status-error">Couldn&rsquo;t reach Ticketmaster. Your browser or network may be blocking the request — try again in a moment.</p>';
    }
  }

  function setupSearch() {
    const toggle = document.getElementById("searchToggle");
    const panel = document.getElementById("searchPanel");
    const keyInput = document.getElementById("tmApiKey");
    const queryInput = document.getElementById("searchQuery");
    const cityInput = document.getElementById("searchCity");
    const searchBtn = document.getElementById("searchBtn");
    const results = document.getElementById("searchResults");

    keyInput.value = loadApiKey();

    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.textContent = panel.hidden ? "Search shows" : "Cancel";
      if (!panel.hidden) (loadApiKey() ? queryInput : keyInput).focus();
    });

    // Save on every keystroke (not just on blur) so the key is never lost —
    // e.g. if the user pastes it and immediately hits Enter to search.
    keyInput.addEventListener("input", () => saveApiKey(keyInput.value.trim()));

    const doSearch = () => runSearch(queryInput.value.trim(), cityInput.value.trim(), results, panel, toggle);
    searchBtn.addEventListener("click", doSearch);
    for (const input of [queryInput, cityInput]) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doSearch();
        }
      });
    }
  }

  // --- Toast ------------------------------------------------------------

  let toastTimer = null;

  function showToast(message) {
    const toast = document.getElementById("toast");
    document.getElementById("toastMessage").textContent = message;
    toast.classList.add("toast-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("toast-visible"), 3000);
  }

  function setupToast() {
    document.getElementById("toastClose").addEventListener("click", () => {
      document.getElementById("toast").classList.remove("toast-visible");
      clearTimeout(toastTimer);
    });
  }

  // --- Auth gate --------------------------------------------------------

  // All iOS browsers (Chrome included) run on WebKit, which doesn't reliably
  // keep signInWithRedirect's sessionStorage marker across the full-page
  // round trip to Google and back — the sign-in silently fails to complete.
  // Popup avoids that by never leaving the page, so use it there instead.
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function setupAuth() {
    const authGate = document.getElementById("authGate");
    const appContent = document.getElementById("appContent");
    const signInBtn = document.getElementById("signInBtn");
    const signOutBtn = document.getElementById("signOutBtn");
    const authError = document.getElementById("authError");
    const userEmail = document.getElementById("userEmail");

    signInBtn.addEventListener("click", () => {
      authError.hidden = true;
      const provider = new firebase.auth.GoogleAuthProvider();
      if (isIOS()) {
        auth.signInWithPopup(provider).catch((err) => {
          authError.textContent = `Sign-in failed: ${err.message}`;
          authError.hidden = false;
        });
      } else {
        auth.signInWithRedirect(provider);
      }
    });

    // Completes the sign-in after Google redirects back here (signInWithRedirect
    // navigates away and back, unlike the popup flow it replaces, so errors
    // surface here instead of at the signInBtn click).
    auth.getRedirectResult().catch((err) => {
      authError.textContent = `Sign-in failed: ${err.message}`;
      authError.hidden = false;
    });

    signOutBtn.addEventListener("click", () => auth.signOut());

    auth.onAuthStateChanged((user) => {
      if (user) {
        authGate.hidden = true;
        appContent.hidden = false;
        userEmail.textContent = user.email || "";
        attachDataListener();
      } else {
        authGate.hidden = false;
        appContent.hidden = true;
      }
    });
  }

  setupAuth();
  setupAddForm();
  setupSearch();
  setupToast();
  render();
})();
