> Implemented — see `CLAUDE.md` for how to run it, and
> `docs/superpowers/specs/2026-08-09-poe-dust-design.md` /
> `docs/superpowers/plans/2026-08-09-poe-dust-implementation.md` for the design
> and implementation history.

web funkcnosti podobny poe heist replika - viz e:\docker\heist\

o co jde: 

chceme stranku, ktera bude nacitat z poe.ninja ceny uniq predmetu, ktere jdou promenit v dust
tj. zbrane, armour, jewerly

prevezmeme zdroj dat z - 
https://docs.google.com/spreadsheets/d/1GAFw_wDGaI1F85T0qfUk18r20ioA0TOhj4JDpNKfGwM/edit?gid=1777750195#gid=1777750195

ovsem tamni dust je jen orientacni - budeme muset najit aktualnejsi zdroj  nekdy v budoucnu - ale je to zaklad

> **Update 2026-08-09:** přešli jsme na přesnější zdroj —
> https://github.com/deronek/poe-disenchant-tool/tree/main/data/dust (`poe-dust.js`).
> Sledovat, jestli ho autor dál udržuje, a podle toho `scripts/seed.csv` občas
> přegenerovat (viz CLAUDE.md, sekce Architecture / Data source).

k zaznamu itemu chceme vest: 

- nazev
- typ (belt, ring, helma, boty...)
- dust ilvl 83
- dust - ilvl 83 + 20 kvality (u jewerly to jsou catalisty...)
- pak 84 a 85 - analogicky
- cena v chaosech

stranka nacte z poe.ninja info o aktualni lize - stejne jako to mame v heistu
tlacitko pro nacteni dat - stejne jako v heist - omezit jednou za hodinu
naparovat ceny do itemu

zobrazeni - nahore filtrace + limit od do v chaosech 


tabulka - nazev, cena v chaosech - a 3 sloupce v ramci levelu: dust level, dust+20q level, prepocet na 1 chaos





lokalne chceme vse vyzkouset = zprovozni docker - via heist


produkce pak bude totozna jako v heist - on render...