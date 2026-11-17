# gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/hayangjelema83/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/hayangjelema83/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast GTA VI's launch-day Twitch viewers hour by hour from the first hour's print. One program, `main.ts` (Node 22, standard library only, no network, deterministic).

## Method

For each forecast hour, the model looks at how past big launches' Twitch audiences moved from their hour-1 print to that hour, and weights each past launch by how close its hour-1 size was to this case's — a Gaussian kernel in log space (bandwidth 1.0). The five quantiles are the kernel-weighted mean and spread of `ln(v_h / v_1)`, centred on the case's own hour-1 print. When the kernel-weighted effective sample behind an hour is thin, the spread is widened by `sqrt(1 + 1/ESS)`, since the spread estimate itself is then unreliable.

Conditioning on hour-1 size is the whole point: across all past launches, hour 1 barely predicts the evening peak (log correlation ~0.18), because a small hour 1 usually means the game had not unlocked yet in the big regions, not that the launch is small. But once hour 1 is already substantial (≥ ~50k viewers), it predicts the evening well (log correlation 0.86, evening 0.7x–2.7x hour 1). Pooling every launch equally, or using the house persistence baseline, misses the evening rise; the kernel keeps both regimes honest.

## Measured performance

Leave-one-out over the 38 comparables in the kit (pinball loss on the log scale, scored exactly as the contest scores it), end-to-end through this `main.ts`:

| forecaster | LOO mean | LOO median | practice-like (hour 1: 20k–300k) | big hour 1 (≥50k) |
|---|---|---|---|---|
| this entry | **0.392** | 0.258 | 0.285 | 0.206 |
| house persistence baseline | 0.930 | 0.325 | 0.349 | 0.251 |

The house baseline's published practice loss is 0.387. Local wall time is ~20 ms per case (limit 8 s); two runs from different working directories are byte-identical.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=eypbxdsh&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
