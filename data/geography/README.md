# Astrounit’s regional context

`atlas.json` is a navigation gazetteer built from Natural Earth’s public-domain
vectors at revision `ca96624a56bd078437bca8184e78163e5039ad19`:

- 258 country/territory records;
- 4,589 named first-order administrative regions;
- 1,046 named physical landscape label areas;
- 295 named marine areas and 326 lakes.

Sources: [Natural Earth administrative regions](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/),
[physical and marine labels](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/),
and [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/).
Original source URLs, SHA-256 digests and the pinned revision are embedded in the
atlas. Records without a name and non-geographic placeholder features are omitted.

Regenerate with Python and Shapely:

```sh
python3 Tools/build_region_atlas.py
```

Polygons preserve topology while simplifying at 0.03 degrees; coordinates are
rounded to three decimal places. Administrative outlines are generalized and
physical label areas are approximate. They support regional storytelling, not
surveyed boundaries, addresses, scientific footprints or a determination of
political status. Small local features may not be represented.

The runtime prioritizes the administrative region for its story and keeps named
landscape context alongside it. Named waters are resolved from their own polygons.
It does not assign the nearest featured mission to an unrelated point.

The Western Desert overview is written from [NASA Earth Observatory’s
*Cultivating Egypt’s Desert*](https://science.nasa.gov/earth/earth-observatory/cultivating-egypts-desert-89820/).
Other detailed regional excerpts are requested from English Wikipedia, using the
feature’s exact Wikidata entity and English article link. Disambiguation pages,
mismatched entities and unrelated source URLs are rejected. The article and
CC BY-SA 4.0 attribution remain visible. Text is bounded to 170 words; Read more
expands the excerpt, and the source opens the full article.

Regional identification is local after this file loads. Story requests send the
region’s entity ID/article title, not Astrounit’s coordinates. Completed excerpts
are cached locally for up to 30 days (80 entries); storage is optional. If the
network is unavailable, geographic/landscape context remains available and the
visitor can retry. Existing radar data, saved observations and discovery records
are not modified.
