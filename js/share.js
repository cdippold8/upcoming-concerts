(function () {
  const DEFAULT_TIME_ZONE = "America/Los_Angeles";
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // Same date/time helpers as app.js — duplicated rather than shared, since
  // this is a plain multi-page static site with no build step or bundler.
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
      month: Number(parts.month) - 1,
      day: Number(parts.day),
      weekday: parts.weekday,
      hour: parts.hour,
      minute: parts.minute,
      dayPeriod: parts.dayPeriod,
    };
  }

  function formatTime(p) {
    const minuteStr = p.minute === "00" ? "" : `:${p.minute}`;
    return `${p.hour}${minuteStr} ${p.dayPeriod}`;
  }

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

  function render(sharedConcerts) {
    const allConcerts = [...CONCERTS, ...sharedConcerts];
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
      summary.textContent = "No upcoming concerts right now.";
      root.innerHTML = '<p class="empty">Nothing on the calendar right now.</p>';
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
          </div>
          ${badge ? `<div class="concert-badge">${badge}</div>` : ""}
        `;

        list.appendChild(card);
      }

      section.appendChild(list);
      root.appendChild(section);
    }
  }

  db.collection("appData")
    .doc("state")
    .onSnapshot(
      (doc) => {
        const data = doc.data() || {};
        render(data.concerts || []);
      },
      (err) => {
        console.error("Failed to load concerts:", err);
        document.getElementById("summary").textContent = "Couldn't load the concert list.";
      }
    );
})();
