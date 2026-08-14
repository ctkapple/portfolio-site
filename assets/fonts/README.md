# Self-hosted web fonts

These four files replace the runtime dependency on `fonts.googleapis.com` and
`fonts.gstatic.com`. The `@font-face` rules that use them live in
`assets/styles.css`, directly above the metric-matched fallback faces — not in a
stylesheet of their own, because a separate file would reintroduce the extra
render-blocking request this change exists to remove.

## What's here

| File | Subset | Size | Axis |
|---|---|---|---|
| `inter-latin.woff2` | latin | 48 KB | `wght` 400–600 |
| `inter-latin-ext.woff2` | latin-ext | 85 KB | `wght` 400–600 |
| `quicksand-latin.woff2` | latin | 28 KB | `wght` 300–700 |
| `quicksand-latin-ext.woff2` | latin-ext | 26 KB | `wght` 300–700 |

Both families are **variable**. Google's `css2` endpoint declares Inter twice —
at 400 and at 600 — but both declarations point at the same file, so one
`@font-face` per subset spans the range and weight 600 costs no second download.

Only `latin` and `latin-ext` were taken. The cyrillic, greek and vietnamese
subsets Google also serves were dropped; nothing on this site is written in
them. Because each face carries a `unicode-range`, the `-ext` files are never
fetched for English text — they cost repository space, not load time. Real
runtime cost for this site is `inter-latin` + `quicksand-latin`, about 76 KB,
and only on a cold cache.

## Where they came from

Fetched from `fonts.gstatic.com` on 2026-08-13, via the URLs in:

```
https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Quicksand:wght@300..700&display=swap
```

requested with a current Chrome user-agent, which is what makes Google return
`woff2` and the variable files rather than legacy formats. Versions at the time
of writing were Inter `v20` and Quicksand `v37`.

## Re-fetching or changing weights

Request that URL with a modern Chrome UA, read the `src:` URLs out of the
returned CSS for the `latin` and `latin-ext` blocks, download those, and update
both the files here and the `unicode-range` values in `assets/styles.css` — the
ranges are copied verbatim from Google's output and should be re-copied rather
than hand-edited. Then bump the `?v=` on all five pages.

If you add a weight, check whether it falls inside the axis ranges above. Inside
the range, nothing needs downloading — only the CSS changes. Outside it, the
files have to be re-fetched with the new range in the query string.

## Licensing

Both families are licensed under the **SIL Open Font License, Version 1.1**,
which expressly permits self-hosting and redistribution.

- **Inter** — Copyright (c) 2016 The Inter Project Authors.
  <https://github.com/rsms/inter> · license: <https://openfontlicense.org/>
- **Quicksand** — Copyright (c) 2011 The Quicksand Project Authors.
  <https://github.com/andrew-paglinawan/QuicksandFamily> · license: <https://openfontlicense.org/>

The OFL requires that this notice travel with the font files. Neither font is
sold, and neither is distributed under a reserved font name that has been
modified — the files are unmodified subsets produced by Google Fonts.
