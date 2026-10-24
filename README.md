# tenantcommons.ca

The Tenant Commons landing page: one address search that opens the tenant's building on the
map ([map.tenantcommons.ca](https://map.tenantcommons.ca)), and a short About section.

Plain HTML, CSS and JavaScript. No build step and no dependencies.

| File | Purpose |
| --- | --- |
| `index.html` | The page. |
| `style.css` | All styling. |
| `app.js` | The address picker: City of Vancouver geocoder over JSONP, then a deep link into the map. |

## Running locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## The address picker

The City geocoder (`maps.vancouver.ca/.../locator_address/GeocodeServer`) sends no CORS headers,
so `app.js` calls it over JSONP: `suggest` as the tenant types, then `findAddressCandidates`
with the picked suggestion's `magicKey`. A typed address that wasn't picked goes through
`suggest` first, because `findAddressCandidates` won't match free text like "1600 beach avenue".

The result becomes a map deep link:

```
https://map.tenantcommons.ca/#pid=<siteId>&lat=<lat>&lon=<lon>&address=<City spelling>
```

The contract is `docs/DEEP_LINKS.md` in the map repo. Change it only in step with the map.

**Privacy:** the address goes to the City geocoder and, in the `#` hash, to the map. The hash
never reaches a server. The site stores nothing and has no analytics. Keep it that way: the
page tells tenants their address isn't stored.
