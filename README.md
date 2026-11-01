# Piaci áttekintő

Egyoldalas, statikus műszerfal részvénykereskedőknek. A célja, hogy az amerikai zárás után egy pillantással látsszon, mennyire kedvező a környezet a trendkövető long swing kereskedéshez: elöl a kereskedési pontszám és a Nasdaq trendszűrő, alattuk a szélesség számai, majd a hangulat, a fő indexek és az amerikai hozamgörbe. Az oldal magyar nyelvű, sötét témájú, és GitHub Pagesre telepíthető. Nincs szerver, nincs előfizetés, nincs API-kulcs.

A számok nem befektetési tanácsok. Késleltetett, harmadik féltől származó adatok, a kereskedés előtt az elsődleges forrás a mérvadó.

## Mit jelent az egyes mutató

**Kereskedési pontszám.** 0-tól 100-ig tartó, a trendkövető long swing környezetet mérő szám. Nem kontrariánus jelzés: az extrém félelem rontja, nem javítja. Öt részpont súlyozott átlaga. Minden rész önmagában is 0–100. Ha egy résznek nincs adata, a súlya a megmaradó részekre oszlik, és a felület kiírja, melyik hiányzik.

| Rész | Súly | Számítás |
| --- | --- | --- |
| Nasdaq-trend | 35% | A Qullamaggie-szabály a Nasdaq Composite-on. Teljes kockázat 100, fél kockázat 50, és ehhez +10 jár, ha az utolsó 5 kereskedési napon a 9 napos EMA alulról keresztezte a 20 naposat. Nincs kereskedés: 0. |
| Szélesség | 25% | Az S&P 500 és a Nasdaq-100 50 és 200 napos átlag feletti arányának átlaga. 20% → 0 pont, 70% → 100 pont, közte lineáris, a tartományon kívül levágva. Ha a négy arányból valamelyik hiányzik, a többi átlaga számít. |
| Volatilitás | 20% | VIX: 15 vagy alatta 100, 30 vagy felette 0, közte lineáris. Ha a VIX a 3 hónapos VIX felett van (invertált szerkezet), 20 pont levonás. Ha a VIX3M hiányzik, a levonás kimarad, és ez a felületen látszik. |
| Hitel | 10% | A bóvli felár szintje (3% vagy alatta 100, 8% vagy felette 0) adja a rész 60%-át. A 20 megfigyeléses változás (−0,5 százalékpont vagy jobb 100, +0,5 vagy rosszabb 0) adja a 40%-át. Emelkedő felár ront. Ha a változás nincs meg, csak a szint számít. |
| Hangulat | 10% | CNN Fear & Greed, enyhe skálán: 0 → 40 pont, 100 → 90 pont (40 + 0,5 × az index). |

Sávok: 0–39 „Nem érdemes kereskedni”, 40–59 „Óvatosan / fél kockázat”, 60–79 „Kedvező”, 80–100 „Erős piac”. A kijelzett szám a súlyozott átlag egészre kerekítve. Az utolsó 60 kereskedési nap pontszáma kis sparkline-on látszik. A részpontok, a súlyok és a képlet a pontszám alatt, a `trading_score` mezőben a JSON-ban is megvan.

**Nasdaq trendszűrő (Qullamaggie).** A Nasdaq Composite (^IXIC) záróára négy átlaghoz képest. A 9 és a 20 napos átlag exponenciális (EMA), az 50 és a 200 napos átlag egyszerű (SMA). A felület mind a négyhez kiírja az átlag értékét, a záróár távolságát százalékban, és hogy az ár felette vagy alatta van.

- Záróár mind a négy átlag felett: „LONG – teljes kockázat”.
- Záróár a 9 napos EMA alatt, de a 20 napos EMA felett: „Fél kockázat”.
- Záróár a 20 napos EMA alatt: „Nincs kereskedés”.
- Záróár a 9 és a 20 napos EMA felett, de az 50 vagy a 200 napos SMA alatt: „Fél kockázat”, azzal a megjegyzéssel, hogy a hosszabb távú átlag alatt van.

Ha a 9 napos EMA az utolsó 5 kereskedési napon alulról keresztezte a 20 naposat, kiemelt jelzés jelenik meg: „Trend eleje: 9-es EMA felfelé keresztezte a 20-ast”, a keresztezés napjával. Különben az utolsó felfelé és az utolsó lefelé keresztezés napja látszik. Ez a szabály a pontszám Nasdaq-trend része is.

**Piaci szélesség.** Az S&P 500 és a Nasdaq-100 összetevői közül hány százalék zár a saját 50 és 200 napos mozgóátlaga felett. Magas érték széles emelkedést jelent, alacsony érték azt, hogy a részvények többsége gyenge, még ha az indexet néhány nagy papír tartja is. Az oldalon a négy aktuális százalék és az 5 kereskedési nappal korábbihoz mért változás látszik. A szélesség vonalgrafikonja nincs a lapon; a történet a JSON-ban megmarad, ebből készül a heti változás és a pontszám szélesség része.

**VIX.** Az S&P 500 opciókból számolt, 30 napos implikált volatilitása. 15 alatt nyugodt a piac, 20–30 között emelkedett a bizonytalanság, 30 felett már félelem.

**VIX lejárati szerkezet.** A 9 napos, a 30 napos (VIX) és a 3 hónapos volatilitás egymáshoz képest. Ha a hosszabb lejárat drágább (contango), a piac nem áraz közeli sokkot. Ha a rövid lejárat a drágább (backwardation), a közeli félelem magasabb: ez stresszes környezet.

**CNN Fear & Greed.** 0-tól 100-ig tartó összesített hangulatindex. Az alacsony érték félelmet, a magas kapzsiságot jelent. A mutató több részpiacot von össze, ezért önmagában nem kereskedési jelzés.

**AAII bika/medve felmérés.** Az amerikai kisbefektetők heti szavazata arról, merre várják a piacot a következő hat hónapban. A bika és a medve arányának különbsége a lényeg. A szélsőséges olvasatot sokan ellentétes jelzésként használják: a nagyon magas medve-arány gyakran túlzott pesszimizmus.

**Put/call arány.** A CBOE részvényopciós put és call forgalmának 5 napos átlaga, a CNN Fear & Greed put/call komponensének nyers értéke. 0,7 alatt kevés a védelmi vétel, 1 felett a putok vannak többségben.

**Magas hozamú felár.** Az amerikai bóvli vállalati kötvények hozamtöbblete az állampapír felett (ICE BofA OAS). Táguló felár kockázatkerülést, szűkülő felár kockázatvállalást jelez.

**Indexek.** Az S&P 500, a Nasdaq-100, a Nasdaq Composite, a Dow Jones, a Russell 2000, a DAX és a BUX záróára, napi változása, valamint a távolsága a saját 50 és 200 napos átlagától. A pozitív távolság azt jelenti, hogy az index az átlag felett van.

**Amerikai hozamok.** A 3 hónapos, 2 éves, 10 éves és 30 éves állampapír hozama, valamint a 10 éves és a 2 éves hozam különbsége. A negatív különbség invertált görbe: a piac gyakran lassulásként olvassa.

**Dollárindex, arany, WTI olaj, bitcoin.** A részvényeken kívüli, gyakran együtt figyelhető piacok, ugyanazzal a napi változással és mozgóátlag-távolsággal.

Ha egy forrás nem válaszol, a kártya nem ürül ki: az utolsó sikeres érték marad, a dátumával és „utolsó ismert adat” jelzéssel. Ha még sosem sikerült a lekérés, a kártya „nem elérhető”.

## Adatforrások

| Mutató | Forrás |
| --- | --- |
| S&P 500 és Nasdaq-100 összetevők | Angol Wikipedia. A listák a `cache/` mappában is megvannak, és a lekérés frissíti őket. Ha a Wikipedia nem elérhető, a gyorsítótár marad. |
| Szélesség | Saját számítás. Az összetevők osztalékkal és felosztással igazított napi záróárából (Yahoo Finance, `yfinance`) készül a 50 és 200 napos átlag, majd a felett záró papírok aránya. |
| Indexek, VIX, VIX9D, VIX3M, dollárindex, arany, olaj, bitcoin | Yahoo Finance, kulcs nélkül. |
| BUX | A Budapesti Értéktőzsde ingyenes historikus letöltése. A Yahoo-n a BUX-nak nincs használható múltja, csak egy napi érték. |
| Állampapír hozamok és a 10 év−2 év spread | FRED nyilvános CSV: `DGS3MO`, `DGS2`, `DGS10`, `DGS30`, `T10Y2Y`. |
| Magas hozamú felár | FRED, `BAMLH0A0HYM2` (ICE BofA US High Yield OAS). |
| Fear & Greed és put/call | A CNN nyilvános Fear & Greed végpontja. A put/call a komponens nyers értéke, nem külön CBOE-előfizetés. |
| AAII | Az [AAII Sentiment Survey](https://www.aaii.com/sentimentsurvey) nyilvánosan kiírt heti eredményei. |
| Kereskedési pontszám és Nasdaq trendszűrő | Származtatott. A `scripts/fetch_data.py` a már letöltött Nasdaq Composite záróárból, a szélességből, a VIX-ből, a bóvli felárból és a Fear & Greed indexből számolja. Nincs hozzá külön adatforrás. |

A CBOE régi, nyilvános put/call CSV-je 2019 októbere óta nem frissül, a teljes történet pedig fizetős. Ezért a put/call a CNN által közölt 5 napos átlag. Az AAII 1987-ig visszanyúló teljes táblája csak tagnak tölthető le; az oldal a nyilvános heteket gyűjti, így a grafikon a futások során hosszabbodik.

A szélesség, a VIX és az indexek története minden futáskor újraszámolható körülbelül három év napi árból (a 200 napos sorozat ebből nagyjából két évet fed). A hozamokból öt év marad a fájlban. Ahol a forrás csak az utolsó heteket adja (AAII), a korábbi pontok a `web/data/dashboard.json` fájlban megmaradnak.

## Hogyan lesz élő az oldal

A munkafolyamat fájljának a `main` ágon kell lennie, különben az ütemezés nem indul. Először tehát ezt a pull requestet be kell olvasztani.

1. **Olvaszd be a pull requestet a `main` ágba.** Ne várj külön telepítésre: a repóban már van mintaadat, az oldal ezzel is kirajzolódik.
2. **Engedélyezd, hogy a munkafolyamat visszaírhasson a repóba.**  
   Settings → Actions → General → Workflow permissions → **Read and write permissions**.  
   Enélkül az adatfrissítés lefut, de a történetet nem tudja elmenteni.
3. **Kapcsold be a GitHub Pagest.**  
   Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. **Indítsd el kézzel az első futást.**  
   Actions → **Adatfrissítés és közzététel** → Run workflow → Branch: `main` → Run workflow.  
   A futás az amerikai zárás utáni adatokat letölti, a JSON-t commitolja, majd a `web/` mappát közzéteszi.
5. Az oldal címe: `https://<felhasználónév>.github.io/piaci-attekinto/`  
   Ennek a repónak várhatóan: <https://kaktuszbaluvb-dot.github.io/piaci-attekinto/>

Ezután a munkafolyamat hétfőtől péntekig 23:30 UTC-kor magától fut (télen 18:30, nyáron 19:30 New York-i idő, az amerikai zárás után). Amerikai ünnepen is elindul, de ilyenkor a piaci dátum az előző kereskedési nap marad. Az „Utolsó frissítés” mindig Európa/Budapest időzónában látszik, a „piaci nap” pedig az utolsó S&P 500 zárás napja.

## Helyi megtekintés és kézi frissítés

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_data.py
python -m http.server -d web 8080
```

Nyisd meg a <http://127.0.0.1:8080> címet. A `file://` megnyitás nem tölti be a JSON-t, kell a helyi szerver.

A `scripts/fetch_data.py` újra letölti a forrásokat, újraszámolja a szélességet, és összefésüli a történetet a meglévő `web/data/dashboard.json` fájllal. Egy forrás hibája nem állítja meg a többit.
