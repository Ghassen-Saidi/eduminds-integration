# Demo day, in order

## Once, the day before

1. `npm install` in this repo and in `edu-minds-app`.
2. Print `assets/print/mat-tp1.png` and `mat-tp2.png` on **A3 landscape, 100 % scale, no fit-to-page**, on matte paper, and `assets/print/tokens.png` on A4 thick paper; glue the tokens to card so they lie flat. The mat is A3 because four 45 mm tokens do not fit an A4 sheet beside four 60 mm corner markers. TP 3 uses `mat-tp3.png` if it is on the script.
3. Check the print: run `npm test` — the marker tests decode the very files you printed.
4. Laptop and phone on the same Wi-Fi. Note the laptop's LAN IP.

## Without the app: the demo page

The repository has its own phone page, so the camera path can be tested before
the app is touched:

```bash
npm run build:demo             # once: bundles the ArUco detector for the browser
bash tools/make-cert.sh        # once: self-signed certificate for HTTPS
npm run demo:tls               # https://<LAN-IP>:8443 — open it on the phone
```

Accept the certificate warning once, allow the camera, pick a TP and point the
phone at the whole mat. The page shows the four corner quad, the slot rings,
which parts it has placed, the lamp (or the sensor voltage on TP 2) and the
simulator's messages; a "sim offline" chip means the page is still usable with
the last result. `npm run check:demo` proves the same path headlessly (3
composed frames → LED on at 21.15 mA for TP 1, sensor powered at 2.23 V for
TP 2, both exercises complete) so a broken network shows up before the phone
does.

## Every run

```bash
# terminal 1 — simulator
python3 services/sim/api.py --port 8000

# terminal 2 — app (in edu-minds-app, with the proxy from docs/APP_WIRING.md)
npm run dev -- --host
```

On the phone: `https://<LAN-IP>:5173`, accept the certificate warning once,
allow camera and motion.

## The 90-second script

1. Log in, put the phone in the headset, wait for the countdown.
2. Look at TP1 for 1.5 s.
3. Place battery → switch → 330 Ω → LED in their slots. The lamp lights within a second of the last token.
4. Swap the 330 Ω token for the 220 Ω one: the lamp burns, the hint says an LED needs a resistor in series.
5. Ask the teacher screen for `failures_prevented` — one red LED, 0.50 TND saved.
6. Flip the LED token: "wrong way round". Flip it back.
7. Use the open-switch token: lamp off, no failure.
8. Optional TP 2: switch the lab, put the 1 kΩ token in R1 and the 330 Ω one in R2
   (battery, sensor across R2). The sensor reads 2.23 V and the exercise completes.
   Swap R2 for the 220 Ω token to show "underpowered", or R1 for 220 Ω to show
   "destroyed" — that is the divider arithmetic made visible.

## If it breaks

| Symptom | First check |
|---|---|
| "sim offline" chip | is `api.py` still running? `curl http://127.0.0.1:8000/v1/health` on the laptop |
| Nothing detected | mat flat, all four corners visible, no direct glare |
| Lamp never lights | are the right four tokens down, and is the switch the closed one (id 8)? |
| Everything frozen | the netlist was rejected: look at the console for `netlist_rejected` |
| Phone cannot load the page | same Wi-Fi? firewall on private networks? |
