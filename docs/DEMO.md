# Demo day, in order

## Once, the day before

1. `npm install` in this repo and in `edu-minds-app`.
2. Print `assets/print/mat-tp1.png` on **A4 landscape, 100 % scale, no fit-to-page**, on matte paper, and `assets/print/tokens.png` on thick paper; glue the tokens to card so they lie flat.
3. Check the print: run `npm test` — the marker tests decode the very files you printed.
4. Laptop and phone on the same Wi-Fi. Note the laptop's LAN IP.

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

## If it breaks

| Symptom | First check |
|---|---|
| "sim offline" chip | is `api.py` still running? `curl http://127.0.0.1:8000/v1/health` on the laptop |
| Nothing detected | mat flat, all four corners visible, no direct glare |
| Lamp never lights | are the right four tokens down, and is the switch the closed one (id 8)? |
| Everything frozen | the netlist was rejected: look at the console for `netlist_rejected` |
| Phone cannot load the page | same Wi-Fi? firewall on private networks? |
