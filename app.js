/**
 * The address picker: suggests City of Vancouver addresses as the tenant types,
 * then opens the map on that building with a deep link
 * (`#pid=…&lat=…&lon=…&address=…`, format: map_explorer docs/DEEP_LINKS.md).
 *
 * The City geocoder sends no CORS headers, so it's called over JSONP. The
 * address goes only to the City and, in the hash, to the map: the hash never
 * reaches a server, and nothing here stores or logs it.
 */
const GEOCODER = 'https://maps.vancouver.ca/server/rest/services/Locator/locator_address/GeocodeServer';
const MAP_URL = 'https://map.tenantcommons.ca/';
const MAX_SUGGESTIONS = 6;
const DEBOUNCE_MS = 180;
const TIMEOUT_MS = 8000;
// Below this, a typed address with no suggestion picked is probably a different one.
const MIN_SCORE = 90;
const DEFAULT_STATUS = "City of Vancouver addresses. Your address isn't stored.";

let jsonpCount = 0;

/** GETs `url` with `params` as JSONP. Rejects on a script error or after TIMEOUT_MS. */
function jsonp(url, params) {
  return new Promise((resolve, reject) => {
    const name = `__tcGeocode${++jsonpCount}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => done(new Error('timeout')), TIMEOUT_MS);
    function done(err, data) {
      clearTimeout(timer);
      // A late reply after a timeout must not throw on a missing callback.
      window[name] = () => {};
      script.remove();
      err ? reject(err) : resolve(data);
    }
    window[name] = (data) => done(null, data);
    script.onerror = () => done(new Error('network'));
    script.src = `${url}?${new URLSearchParams({ ...params, f: 'json', callback: name })}`;
    document.head.append(script);
  });
}

function suggest(text) {
  return jsonp(`${GEOCODER}/suggest`, { text, maxSuggestions: MAX_SUGGESTIONS })
    .then((data) => (data.suggestions || []).filter((s) => !s.isCollection));
}

/** The best candidate for a picked suggestion (magicKey) or free text, or null. */
function locate(text, magicKey) {
  const params = { SingleLine: text, outSR: 4326, outFields: '*', maxLocations: 1 };
  if (magicKey) params.magicKey = magicKey;
  return jsonp(`${GEOCODER}/findAddressCandidates`, params)
    .then((data) => (data.candidates || [])[0] || null);
}

/** The map's deep link for a geocoder candidate. Sends everything; the map ignores what's invalid. */
function deepLink(candidate) {
  let siteId = '';
  try {
    siteId = JSON.parse(candidate.attributes.User_fld || '{}').siteId || '';
  } catch { /* no PID: the map matches by address */ }
  const params = new URLSearchParams();
  if (siteId) params.set('pid', siteId);
  params.set('lat', candidate.location.y.toFixed(6));
  params.set('lon', candidate.location.x.toFixed(6));
  params.set('address', candidate.address);
  return `${MAP_URL}#${params}`;
}

function init() {
  const form = document.getElementById('search');
  const input = document.getElementById('address');
  const list = document.getElementById('suggestions');
  const status = document.getElementById('status');
  const button = form.querySelector('button');

  let items = [];
  let active = -1;
  let timer = 0;
  // Only the latest request's reply is shown: replies can arrive out of order.
  let latest = 0;

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.classList.toggle('error', isError);
  }

  function render() {
    list.replaceChildren(...items.map((s, i) => {
      const li = document.createElement('li');
      li.id = `suggestion-${i}`;
      li.setAttribute('role', 'option');
      li.textContent = s.text;
      li.setAttribute('aria-selected', String(i === active));
      // mousedown, not click: click would fire after the input's blur closes the list.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); go(s.text, s.magicKey); });
      return li;
    }));
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0) input.setAttribute('aria-activedescendant', `suggestion-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function close() {
    items = [];
    active = -1;
    render();
  }

  async function go(text, magicKey) {
    close();
    input.value = text;
    button.disabled = true;
    setStatus('Finding your building…');
    try {
      const candidate = await locate(text, magicKey);
      if (!candidate || (!magicKey && candidate.score < MIN_SCORE)) {
        setStatus("We couldn't find that City of Vancouver address. Check the spelling, or pick one of the suggestions as you type.", true);
        return;
      }
      window.location.assign(deepLink(candidate));
    } catch {
      setStatus("The City's address search isn't responding. Try again in a moment.", true);
    } finally {
      button.disabled = false;
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    setStatus(DEFAULT_STATUS);
    const text = input.value.trim();
    if (text.length < 3) { latest++; close(); return; }
    timer = setTimeout(async () => {
      const id = ++latest;
      try {
        const found = await suggest(text);
        if (id !== latest) return;
        items = found;
        active = -1;
        render();
      } catch {
        if (id === latest) close();
      }
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + items.length) % items.length;
      render();
    } else if (e.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', close);

  /**
   * Submitted without picking a suggestion. findAddressCandidates is strict
   * ("1600 beach avenue" finds nothing) but suggest isn't, so go through it:
   * one match is the address, several are for the tenant to choose from.
   */
  async function typed(text) {
    clearTimeout(timer);
    const id = ++latest;
    try {
      const found = await suggest(text);
      if (id !== latest) return;
      if (found.length === 1) return go(found[0].text, found[0].magicKey);
      if (found.length === 0) return go(text);
      items = found;
      active = -1;
      render();
      input.focus();
      setStatus('Several addresses match. Pick yours from the list.');
    } catch {
      setStatus("The City's address search isn't responding. Try again in a moment.", true);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const picked = items[active];
    if (picked) go(picked.text, picked.magicKey);
    else if (input.value.trim()) typed(input.value.trim());
    else input.focus();
  });
}

init();
