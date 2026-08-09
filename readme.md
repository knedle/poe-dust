# poe-dust

Webová stránka, která ukazuje, jaké Path of Exile unique itemy se vyplatí
kupovat a rozenchantovat na dust — pro každý item spočítá poměr
dust-za-chaos vůči aktuální ceně z poe.ninja.

Architektura a vzhled vychází z `E:\docker\heist` (poe-heist replika).

## Jak to funguje

- Appka nese vlastní seznam itemů s jejich dust hodnotami (`scripts/seed.csv`,
  naimportováno do SQLite databáze při každém startu serveru).
- Po kliknutí na **Load** stáhne z poe.ninja aktuální ceny (`UniqueWeapon`,
  `UniqueArmour`, `UniqueAccessory`) pro zvolenou ligu a napáruje je k itemům
  podle jména. Načtení je omezené na jednou za hodinu (server cachuje
  odpověď).
- Item, ke kterému se v aktuální lize nenajde cena, se v tabulce vůbec
  nezobrazí.
- Nahoře jde filtrovat podle jména, rozsahu ceny v chaosech a podle počtu
  slotů, které item zabírá v inventáři (prsten = 1, opasek = 2, boty = 4...).
- Tabulka: název, počet slotů, cena v chaosech, dust (ilvl 84), dust +20 %
  kvalita (ilvl 84), a přepočet dust/chaos. Klik na hlavičku sloupce řadí,
  klik na název itemu ho zkopíruje do schránky.
- Appka je čistě **read-only** — žádné přihlašování ani editace dat přímo ve
  webu (dřív existovalo, zrušeno 2026-08-09, viz `CLAUDE.md`).

## Zdroj dust dat

Aktuálně: https://github.com/deronek/poe-disenchant-tool (`data/dust/poe-dust.js`)
— přesnější než původní zdroj (Google Sheet), protože počítá s kvalitním
bonusem per-item (ne plošných +20 %) a nezahrnuje nesmyslné položky
(fragmenty typu "Piece of ..."). Je potřeba občas zkontrolovat, jestli se
repo dál udržuje, a `scripts/seed.csv` z něj přegenerovat — postup je
popsaný v `CLAUDE.md` (sekce Architecture → Data source).

Data se omezují na item level 84 — zdroj spolehlivě nepokrývá ilvl 83/85,
takže jsme je z appky úplně odstranili (2026-08-09), místo abychom drželi
nepoužitelné/prázdné sloupce.

Původní zdroj (jen pro historii, už se nepoužívá):
https://docs.google.com/spreadsheets/d/1GAFw_wDGaI1F85T0qfUk18r20ioA0TOhj4JDpNKfGwM

## Spuštění

Lokálně přes Docker (viz `CLAUDE.md`):

```bash
docker compose up -d
```

Produkce: Render, free tier, stejně jako heist — návod krok za krokem je
v `DEPLOY.md`. GitHub: https://github.com/knedle/poe-dust.

## Další dokumentace

- `CLAUDE.md` — architektura, jak appka běží, jak se aktualizují data
- `DEPLOY.md` — nasazení na Render
- `docs/superpowers/specs/2026-08-09-poe-dust-design.md` — původní design spec
- `docs/superpowers/plans/2026-08-09-poe-dust-implementation.md` — implementační plán
