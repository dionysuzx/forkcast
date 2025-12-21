# Backfill `forkRelationships[].statusHistory` from 2025 ACD call artifacts

## Summary

- Backfilled `forkRelationships[].statusHistory[].call` + `.date` where calls explicitly recorded CFI/DFI/PFI (and one `Withdrawn`) decisions.
- Added missing intermediate stages (`Proposed`, `Considered`, `Scheduled`) only when supported by call artifacts.
- Committed one “statusHistory backfill” commit per call with changes (existing `acde/226` backfill commit retained).
- Tracked the generated `src/data/eips.json` so reviewers can diff compiled output alongside per-EIP sources (`src/data/eips/*.json`).

## Calls With Status Changes

- `acde/209` (2025-04-10): CFI `EIP-7918` for `Fusaka` (`632298782fa4d6980ecb55aec0117bbb04bac19d`)
  - Sources: `public/artifacts/acde/2025-04-10_209/chat.txt`
  - Evidence: stokes reply “Lets do it” to “CFI 7918…”
- `acde/211` (2025-05-08): Confirmed “Other CFI’d Fusaka EIPs” list (`c692ce9887c53f11ac914ff734b25435dfc90a01`)
  - Sources: `public/artifacts/acde/2025-05-08_211/chat.txt`
  - Notes: RIP-7212 is mentioned in the call but is not represented in `src/data/eips/*.json` (EIP-only data set).
- `acde/212` (2025-05-22): Fusaka devnet scoping + DFI `EIP-7762` (`494acf28b7d8d54f6194fda43f3e1ebc95423aac`)
  - Sources: `public/artifacts/acde/2025-05-22_212/chat.txt` (Tim’s multi-line summary)
- `acdc/167` (2025-10-16): PFI `EIP-7688` for `Glamsterdam` (`4a037687d595853f3aaaf18f683f05213dced1dc`)
  - Sources: `public/artifacts/acdc/2025-10-16_167/agenda.json`
- `acde/223` (2025-10-23): Removed `EIP-7667` + `EIP-6873` from Glamsterdam PFI list (`935a57bf7969388054f116c13ad500f2c08ac6cb`)
  - Sources: `public/artifacts/acde/2025-10-23_223/tldr.json`
- `acdc/169` (2025-11-13): DFI `EIP-8068` for `Glamsterdam` (`881d84d64101a45f5e8da930016a1368cdf6729d`)
  - Sources: `public/artifacts/acdc/2025-11-13_169/tldr.json`
- `acdc/170` (2025-11-27): DFI/CFI decisions around `EIP-7805`, `EIP-8045`, `EIP-8062`, `EIP-8071` (`598637055711edf254e527652509cb8e32fcc30c`)
  - Sources: `public/artifacts/acdc/2025-11-27_170/tldr.json`
- `acde/225` (2025-12-04): Glamsterdam CFI + DFI lists (`7d894fd29cb19b76e97a4f2c1f2b8a108909e1d9`)
  - Sources: `public/artifacts/acde/2025-12-04_225/tldr.json`
- `acdc/171` (2025-12-11): CFI `EIP-7688`, `EIP-8061`, `EIP-8080` for `Glamsterdam` (`6b4fd79fbfeb77cc1eb8ea98bf557c4b7d9f12d6`)
  - Sources: `public/artifacts/acdc/2025-12-11_171/tldr.json`
- `acde/226` (2025-12-18): Glamsterdam CFI/DFI repricing bundle (`5f6f494bbb4ab19f60877a886b042481b6e9d495`)
  - Sources: `public/artifacts/acde/2025-12-18_226/tldr.json`

## Call Resolution Matrix

Each call from the provided table is either:
- backed by a `statusHistory` backfill commit (linked), or
- explicitly marked “no status changes” (reviewed against the call’s artifacts).

### ACDC

| call | date | first-appearance commit | statusHistory backfill | artifacts reviewed |
| --- | --- | --- | --- | --- |
| `acdc/154` | 2025-04-03 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/155` | 2025-04-17 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/156` | 2025-05-01 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/157` | 2025-05-15 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/158` | 2025-05-29 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/159` | 2025-06-26 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/160` | 2025-07-10 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/161` | 2025-07-24 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/162` | 2025-08-07 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/163` | 2025-08-21 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/164` | 2025-09-04 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdc/165` | 2025-09-18 | https://github.com/ethereum/forkcast/commit/7699647160dcfc387e4a38ef9c08963596686bff | none | `chat.txt`, `transcript.vtt` |
| `acdc/166` | 2025-10-02 | https://github.com/ethereum/forkcast/commit/20af5dec1cdbd93ad9b4c76ebce288b536ed5acc | none | `chat.txt`, `transcript.vtt`, `summary.json` |
| `acdc/167` | 2025-10-16 | https://github.com/ethereum/forkcast/commit/55bc0a10c930043a6902e6500fcaf5d27b8c13f1 | https://github.com/ethereum/forkcast/commit/4a037687d595853f3aaaf18f683f05213dced1dc | `agenda.json` |
| `acdc/168` | 2025-10-30 | https://github.com/ethereum/forkcast/commit/72b9f1bba1dbb5e95a679b6c0b516ecf9314fac8 | none | `tldr.json` |
| `acdc/169` | 2025-11-13 | https://github.com/ethereum/forkcast/commit/df6a23472fae5c65775de8489d883022470791b6 | https://github.com/ethereum/forkcast/commit/881d84d64101a45f5e8da930016a1368cdf6729d | `tldr.json` |
| `acdc/170` | 2025-11-27 | https://github.com/ethereum/forkcast/commit/d93e58ec410fc70141f642961a9603bb713f644f | https://github.com/ethereum/forkcast/commit/598637055711edf254e527652509cb8e32fcc30c | `tldr.json` |
| `acdc/171` | 2025-12-11 | https://github.com/ethereum/forkcast/commit/e24ff0d0e1e645d59054f8459dacf769800c8d0d | https://github.com/ethereum/forkcast/commit/6b4fd79fbfeb77cc1eb8ea98bf557c4b7d9f12d6 | `tldr.json` |

### ACDE

| call | date | first-appearance commit | statusHistory backfill | artifacts reviewed |
| --- | --- | --- | --- | --- |
| `acde/208` | 2025-03-27 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/209` | 2025-04-10 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | https://github.com/ethereum/forkcast/commit/632298782fa4d6980ecb55aec0117bbb04bac19d | `chat.txt` |
| `acde/210` | 2025-04-24 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/211` | 2025-05-08 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | https://github.com/ethereum/forkcast/commit/c692ce9887c53f11ac914ff734b25435dfc90a01 | `chat.txt` |
| `acde/212` | 2025-05-22 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | https://github.com/ethereum/forkcast/commit/494acf28b7d8d54f6194fda43f3e1ebc95423aac | `chat.txt` |
| `acde/213` | 2025-06-05 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/214` | 2025-06-19 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/215` | 2025-07-03 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/216` | 2025-07-17 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/217` | 2025-07-31 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/218` | 2025-08-14 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/219` | 2025-08-28 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acde/220` | 2025-09-11 | https://github.com/ethereum/forkcast/commit/a7e360965564041064ba226cddeb105ccae73499 | none | `chat.txt`, `transcript.vtt` |
| `acde/221` | 2025-09-25 | https://github.com/ethereum/forkcast/commit/db761187c7b2cfcc9e1b0e3d26434186ea4ac39f | none | `summary.json`, `chat.txt`, `transcript.vtt` |
| `acde/222` | 2025-10-09 | https://github.com/ethereum/forkcast/commit/34b0da642f9a7440f1c9c80c4145c8699350c860 | none | `agenda.json`, `chat.txt`, `transcript.vtt` |
| `acde/223` | 2025-10-23 | https://github.com/ethereum/forkcast/commit/960162a50b9af64e4194c09e0c42e2b7611b75a4 | https://github.com/ethereum/forkcast/commit/935a57bf7969388054f116c13ad500f2c08ac6cb | `tldr.json` |
| `acde/224` | 2025-11-06 | https://github.com/ethereum/forkcast/commit/b66c64b26fc907beeaacbdebfae78628ee4933c9 | none | `tldr.json` (explicitly “No final CFI/DFI decisions today”) |
| `acde/225` | 2025-12-04 | https://github.com/ethereum/forkcast/commit/354438160335245c81669ffab55bf90d2f72b313 | https://github.com/ethereum/forkcast/commit/7d894fd29cb19b76e97a4f2c1f2b8a108909e1d9 | `tldr.json` |
| `acde/226` | 2025-12-18 | https://github.com/ethereum/forkcast/commit/8f3253a646ec19fdd3cce2410304537c62eaa45f | https://github.com/ethereum/forkcast/commit/5f6f494bbb4ab19f60877a886b042481b6e9d495 | `tldr.json` |

### ACDT

| call | date | first-appearance commit | statusHistory backfill | artifacts reviewed |
| --- | --- | --- | --- | --- |
| `acdt/040` | 2025-06-16 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/041` | 2025-06-23 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/042` | 2025-06-30 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/043` | 2025-07-07 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/044` | 2025-07-14 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/045` | 2025-07-21 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/046` | 2025-07-28 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/047` | 2025-08-04 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/048` | 2025-08-11 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/049` | 2025-08-18 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/050` | 2025-08-25 | https://github.com/ethereum/forkcast/commit/eaf0f9607a73750a004bb95baa40ff071a080d8d | none | `chat.txt`, `transcript.vtt` |
| `acdt/051` | 2025-09-01 | https://github.com/ethereum/forkcast/commit/7539ce355a6f8ba2605b1fc0daf1584dd3390f88 | none | `chat.txt`, `transcript.vtt` |
| `acdt/052` | 2025-09-08 | https://github.com/ethereum/forkcast/commit/7539ce355a6f8ba2605b1fc0daf1584dd3390f88 | none | `chat.txt`, `transcript.vtt` |
| `acdt/053` | 2025-09-15 | https://github.com/ethereum/forkcast/commit/23996002236317aa53e0dd61e802d5efbc084b63 | none | `chat.txt`, `transcript.vtt` |
| `acdt/054` | 2025-09-22 | https://github.com/ethereum/forkcast/commit/d797f3250e71e7008237cb7601941f99a02cf59f | none | `chat.txt`, `transcript.vtt` |
| `acdt/055` | 2025-09-29 | https://github.com/ethereum/forkcast/commit/39e2c2a8e55e9aaf33ac4d9351e5c30c9e462b98 | none | `chat.txt`, `transcript.vtt` |
| `acdt/056` | 2025-10-06 | https://github.com/ethereum/forkcast/commit/53b9a7dd0b9191a81697018210959768272edd0a | none | `chat.txt`, `transcript.vtt` |
| `acdt/057` | 2025-10-13 | https://github.com/ethereum/forkcast/commit/e4bb6da115ee8d4595be8c32eee6ef24fe1ba94d | none | `chat.txt`, `transcript.vtt`, `agenda.json`, `summary.json` |
| `acdt/058` | 2025-10-20 | https://github.com/ethereum/forkcast/commit/b0818c36b241c9e68e3511b3def9657c44348028 | none | `tldr.json` |
| `acdt/059` | 2025-10-27 | https://github.com/ethereum/forkcast/commit/3dcec04021708b6a267d9c920a6647b6724b6035 | none | `tldr.json` |
| `acdt/060` | 2025-11-03 | https://github.com/ethereum/forkcast/commit/2c630d55d4a7927d11b0398d90bf244dcfd750db | none | `tldr.json` |
| `acdt/061` | 2025-11-10 | https://github.com/ethereum/forkcast/commit/92ee6955126701c59825dda1136df1d36d85d2b1 | none | `tldr.json` |
| `acdt/062` | 2025-12-01 | https://github.com/ethereum/forkcast/commit/3ee480db3b743e7850633daeb66e02edf8b4f62c | none | `tldr.json` |
| `acdt/063` | 2025-12-08 | https://github.com/ethereum/forkcast/commit/2438accbf31f8964309e1590e1170f32c2191d41 | none | `tldr.json` |
| `acdt/064` | 2025-12-15 | https://github.com/ethereum/forkcast/commit/751b437ede166b59133ba0d4283dbd6679167ccb | none | `tldr.json` |

## Notes On “No Status Changes”

Calls marked “none” above may still discuss the CFI/SFI/DFI framework or individual EIPs, but contain no explicit decision statements tying an EIP to a new inclusion status in the call artifacts.

## Validation Checklist

- [ ] Run `npm run compile-eips` and ensure it succeeds (schema validation).
- [ ] For each call in “Calls With Status Changes”:
  - [ ] Open the referenced artifact file(s) in `public/artifacts/...` and locate the exact decision text.
  - [ ] Open the corresponding statusHistory commit and verify the `forkRelationships[].statusHistory` diff matches that call’s decision(s).
- [ ] For any call marked “no status changes”:
  - [ ] Open that call’s artifact directory and confirm there are no explicit status-change decisions for EIPs.
