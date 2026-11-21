# Print assets

`tokens.png`, `mat-tp1.png`, `mat-tp3.png` and their `.layout.json` files are
generated, not hand-drawn:

```bash
npm install        # js-aruco2 + sharp
npm run print
```

Every marker is drawn from the same dictionary the vision code uses
(`ARUCO_MIP_36h12`), and `tests/markers.test.js` crops each one back out of the
PNG and decodes it, so a broken sheet fails the test suite.

Print at **A4, 100 % scale, no fit-to-page**, on matte paper. The mats are
landscape (297 × 210 mm); the token sheet is landscape too.

Copies live in Ghassen's Google Drive as of 21 November (the private git store
used for this repository does not accept binary files):

- `EduMinds tokens A4.png` — 10 tokens, 45 mm
- `EduMinds mat TP1 A4.png` — corners 100–103, TP1 slot outlines
- `EduMinds mat TP3 A4.png` — corners 100–103, TP3 slot outlines

**Size matters:** the mats are A3 landscape (420 × 297 mm). On A4, the clear
band inside four 60 mm corner markers is 161 × 74 mm — not enough for four
45 mm tokens, and a token placed there covers a corner and makes the mat
undetectable. The token sheet is A4.
