# Piaci áttekintő

Egyoldalas, statikus műszerfal részvénykereskedőknek. A célja, hogy egy pillantással látsszon, mennyire kedvező a környezet a trendkövető, emelkedésre játszó swing kereskedéshez. Az oldal magyar nyelvű, világos és sötét témával, és GitHub Pagesre telepíthető. Nincs szerver, nincs előfizetés, nincs API-kulcs.

Az oldal tetején a kereskedési pontszám áll, alatta a Nasdaq trendszűrő és a fő indexek, majd a piaci szélesség, a volatilitás és a hangulat, a kamatok és a hitelkockázat, a szektorok, végül a napi hírek.

Tájékoztató jellegű, nem befektetési tanács. Az adatok késleltetettek, harmadik féltől származnak, és hibát tartalmazhatnak. Kereskedés előtt az elsődleges forrás a mérvadó.

## Mit jelent az egyes mutató

**Kereskedési pontszám.** 0-tól 100-ig tartó szám. Azt méri, mennyire kedvező a környezet a trendkövető long swinghez. Nem fordított jelzés: az extrém félelem rontja, nem javítja. Öt részpont súlyozott átlaga. Minden rész önmagában is 0–100. Ha egy résznek nincs adata, a súlya a megmaradó részekre oszlik, és a felület kiírja, melyik hiányzik.

| Rész | Súly | Számítás |
| --- | --- | --- |
| Nasdaq-trend | 35% | A Nasdaq Composite záróára a 9 és 20 napos exponenciális, valamint az 50 és 200 napos egyszerű átlaghoz képest. Mind a négy felett 100. Vegyes helyzet 50, és ehhez +10 jár, ha az utolsó 5 kereskedési napon a 9 napos EMA alulról keresztezte a 20 naposat. A 20 napos alatt: 0. |
| Piaci szélesség | 25% | Az S&P 500 és a Nasdaq-100 50 és 200 napos átlag feletti arányának átlaga. 20% → 0 pont, 70% → 100 pont, közte lineáris. Ha a négy arányból valamelyik hiányzik, a többi átlaga számít. |
| Volatilitás | 20% | VIX: 15 vagy alatta 100, 30 vagy felette 0, közte lineáris. Ha a VIX a 3 hónapos VIX felett van, 20 pont levonás. Ha a VIX3M hiányzik, a levonás kimarad, és ez a felületen látszik. |
| Hitelkockázat | 10% | A bóvli felár szintje (3% vagy alatta 100, 8% vagy felette 0) adja a rész 60%-át. A 20 megfigyeléses változás (−0,5 százalékpont vagy jobb 100, +0,5 vagy rosszabb 0) adja a 40%-át. Emelkedő felár ront. Ha a változás nincs meg, csak a szint számít. |
| Hangulat | 10% | CNN Fear & Greed, enyhe skálán: 0 → 40 pont, 100 → 90 pont. |

Sávok: 0–39 „Nem érdemes kereskedni”, 40–59 „Óvatosan / fél kockázat”, 60–79 „Kedvező”, 80–100 „Erős piac”. A kijelzett szám a súlyozott átlag egészre kerekítve. Az utolsó 60 kereskedési nap pontszáma kis görbén látszik. A részpontok és a képlet a „Hogyan számolunk?” lenyílóban, a `trading_score` mezőben a JSON-ban is megvan.

**Nasdaq trendszűrő.** A Nasdaq Composite (^IXIC) záróára négy átlaghoz képest. A 9 és a 20 napos átlag exponenciális (EMA), az 50 és a 200 napos egyszerű (SMA). A felület mind a négyhez kiírja az átlag értékét, a záróár távolságát százalékban, és hogy az ár felette vagy alatta van.

- Záróár mind a négy átlag felett: „Teljes kockázat”. A rövid és a hosszú trend együtt emelkedik.
- Záróár a 9 napos EMA alatt, de a 20 napos EMA felett: „Fél kockázat”.
- Záróár a 20 napos EMA alatt: „Nincs kereskedés”.
- Záróár a 9 és a 20 napos EMA felett, de az 50 vagy a 200 napos SMA alatt: „Fél kockázat”, azzal a megjegyzéssel, hogy a hosszabb távú átlag alatt van.

Ha a 9 napos EMA az utolsó 5 kereskedési napon alulról keresztezte a 20 naposat, kiemelt jelzés jelenik meg a keresztezés napjával. Különben az utolsó felfelé és az utolsó lefelé keresztezés napja látszik.

**Piaci szélesség.** Az S&P 500 és a Nasdaq-100 összetevői közül hány százalék zár a saját 50 és 200 napos mozgóátlaga felett. Magas érték széles emelkedést jelent, alacsony érték azt, hogy a részvények többsége gyenge, még ha az indexet néhány nagy papír tartja is. Az oldalon a négy aktuális százalék és az 5 kereskedési nappal korábbihoz mért változás látszik. Vonalgrafikon nincs; a történet a JSON-ban megmarad.

**VIX.** Az S&P 500 opciókból számolt, 30 napos implikált volatilitása. 15 alatt nyugodt a piac, 20–30 között emelkedett a bizonytalanság, 30 felett már félelem.

**VIX lejárati szerkezet.** A 9 napos, a 30 napos (VIX) és a 3 hónapos volatilitás egymáshoz képest. Ha a hosszabb lejárat drágább (contango), a piac nem áraz közeli sokkot. Ha a rövid lejárat a drágább (backwardation), a közeli félelem magasabb: ez stresszes környezet.

**CNN Fear & Greed.** 0-tól 100-ig tartó összesített hangulatindex. Az alacsony érték félelmet, a magas kapzsiságot jelent. Önmagában nem kereskedési jelzés.

**AAII bika/medve felmérés.** Az amerikai kisbefektetők heti szavazata arról, merre várják a piacot a következő hat hónapban. A bika és a medve arányának különbsége a lényeg. A nagyon magas medve-arányt sokan túlzott pesszimizmusként olvassák.

**Put/call arány.** A CBOE részvényopciós put és call forgalmának 5 napos átlaga. 0,7 alatt kevés a védelmi vétel, 1 felett a putok vannak többségben.

**Bóvli kötvényfelár.** Az amerikai gyenge besorolású vállalati kötvények hozamtöbblete az állampapír felett (ICE BofA OAS). Táguló felár kockázatkerülést, szűkülő felár kockázatvállalást jelez.

**Indexek.** Az S&P 500, a Nasdaq-100, a Nasdaq Composite, a Dow Jones, a Russell 2000, a DAX és a BUX záróára, napi változása, valamint a távolsága a saját 50 és 200 napos átlagától. A pozitív távolság azt jelenti, hogy az index az átlag felett van.

**Amerikai hozamok.** A 3 hónapos, 2 éves, 10 éves és 30 éves állampapír hozama, valamint a 10 éves és a 2 éves hozam különbsége. A negatív különbség fordított görbe: a piac gyakran lassulásként olvassa.

**Szektorok.** Az S&P 500 tizenegy GICS szektora SPDR ETF-eken (XLK, XLF, XLV, XLY, XLP, XLE, XLI, XLB, XLU, XLRE, XLC), magyar névvel. Az elsődleges sor az utolsó 5 kereskedési nap hozama, a legerősebbtől a leggyengébbig. Mellette az 1 hónap (21 kereskedési nap), az év eleje óta mért hozam, és a különbség az S&P 500 ETF-hez (SPY) képest ugyanazon a héten. A pozitív különbség felülteljesítés. A három legerősebb és a három leggyengébb ki van emelve.

**Napi hírek.** Körülbelül 8–12 fontosabb piaci cím az elmúlt 36 órából. A cím eredeti nyelvén látszik, a forrással, budapesti idővel és egy új lapon nyíló hivatkozással. Ismétlődő címek kiesnek. Ha egy hírfolyam nem válaszol, a többi megmarad.

**Dollárindex, arany, WTI olaj, bitcoin.** A részvényeken kívüli, gyakran együtt figyelt piacok.

Ha egy forrás nem válaszol, a kártya nem ürül ki: az utolsó sikeres érték marad, a dátumával és „utolsó ismert adat” jelzéssel. Ha még sosem sikerült a lekérés, a kártya „nem elérhető”.

## Megjelenés

A felület rendszer-betűt használ, a számok táblázatosak. A világos és a sötét téma külön van megtervezve. Az alapértelmezés a böngésző `prefers-color-scheme` beállítását követi; a fejléc kapcsolója után a választás a `localStorage`-ban megmarad (`piaci-theme`). A téma a betöltés előtt beáll, hogy ne villanjon fel a rossz változat. A grafikonok a témával együtt színeződnek át.

## Adatforrások

| Mutató | Forrás |
| --- | --- |
| S&P 500 és Nasdaq-100 összetevők | Angol Wikipedia. A listák a `cache/` mappában is megvannak. Ha a Wikipedia nem elérhető, a gyorsítótár marad. |
| Szélesség | Saját számítás. Az összetevők osztalékkal és felosztással igazított napi záróárából (Yahoo Finance, `yfinance`) készül a 50 és 200 napos átlag, majd a felett záró papírok aránya. |
| Indexek, VIX, VIX9D, VIX3M, dollárindex, arany, olaj, bitcoin, szektor ETF-ek, SPY | Yahoo Finance, kulcs nélkül. |
| BUX | A Budapesti Értéktőzsde ingyenes historikus letöltése. |
| Állampapír hozamok és a 10 év−2 év spread | FRED nyilvános CSV: `DGS3MO`, `DGS2`, `DGS10`, `DGS30`, `T10Y2Y`. Kulcs nem kell. Ha a FRED nem válaszol, az amerikai pénzügyminisztérium napi hozamgörbéje a tartalék; a 10 év−2 év különbséget ilyenkor a két hozam különbségeként számoljuk. |
| Bóvli kötvényfelár | FRED, `BAMLH0A0HYM2` (ICE BofA US High Yield OAS). |
| Fear & Greed és put/call | A CNN nyilvános Fear & Greed végpontja. |
| AAII | Az [AAII Sentiment Survey](https://www.aaii.com/sentimentsurvey) nyilvánosan kiírt heti eredményei. |
| Hírek | Ingyenes RSS, kulcs nélkül: CNBC (címlap, eredmények, gazdaság), MarketWatch címlap, Yahoo Finance, Portfolio.hu, valamint Reuters a Google News `reuters.com`-ra szűrt folyamán keresztül. A Reuters saját RSS-e kulcs nélkül nem elérhető. |
| Kereskedési pontszám és Nasdaq trendszűrő | Származtatott. A `scripts/fetch_data.py` a már letöltött adatokból számolja. |

A FRED élhálózata a böngészős és a hosszú egyedi azonosítójú kéréseket válasz nélkül hagyja (a kapcsolat megnyílik, a törzs nem érkezik meg). A lekérés ezért rövid, nem böngészős azonosítót küld, és néhányszor újrapróbálja. Ez volt az oka, hogy a hozamok és a bóvli felár korábban „utolsó ismert adat” jelzéssel maradtak.

A CBOE régi, nyilvános put/call CSV-je 2019 októbere óta nem frissül, a teljes történet pedig fizetős. Ezért a put/call a CNN által közölt 5 napos átlag. Az AAII 1987-ig visszanyúló teljes táblája csak tagnak tölthető le; az oldal a nyilvános heteket gyűjti.

A szélesség, a VIX és az indexek története minden futáskor újraszámolható körülbelül három év napi árból. A hozamokból öt év marad a fájlban. Ahol a forrás csak az utolsó elemeket adja (AAII, hírek), a korábbi pontok a `web/data/dashboard.json` fájlban megmaradnak, a híreknél csak az időablakon belüliek.

## Hogyan lesz élő az oldal

A munkafolyamat fájljának a `main` ágon kell lennie, különben az ütemezés nem indul. Először tehát ezt a pull requestet be kell olvasztani.

1. **Olvaszd be a pull requestet a `main` ágba.** A repóban van mintaadat, az oldal ezzel is kirajzolódik.
2. **Engedélyezd, hogy a munkafolyamat visszaírhasson a repóba.**  
   Settings → Actions → General → Workflow permissions → **Read and write permissions**.
3. **Kapcsold be a GitHub Pagest.**  
   Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. **Indítsd el kézzel az első futást.**  
   Actions → **Adatfrissítés és közzététel** → Run workflow → Branch: `main` → Run workflow.
5. Az oldal címe: `https://<felhasználónév>.github.io/piaci-attekinto/`  
   Ennek a repónak várhatóan: <https://kaktuszbaluvb-dot.github.io/piaci-attekinto/>

Ezután a munkafolyamat hétfőtől péntekig kétszer fut: 23:30 UTC-kor (amerikai zárás után; télen 18:30, nyáron 19:30 New York-i idő) és 05:30 UTC-kor (európai reggel; télen 06:30, nyáron 07:30 Budapest). Kézzel is indítható. Amerikai ünnepen is elindul, de ilyenkor a piaci dátum az előző kereskedési nap marad. Egy forrás hibája nem állítja meg a többit, és nem teszi sikertelenné a közzétételt. Az „Utolsó frissítés” mindig Európa/Budapest időzónában látszik, a „piaci nap” pedig az utolsó S&P 500 zárás napja.

## Helyi megtekintés és kézi frissítés

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_data.py
python -m http.server -d web 8080
```

Nyisd meg a <http://127.0.0.1:8080> címet. A `file://` megnyitás nem tölti be a JSON-t, kell a helyi szerver.

A `scripts/fetch_data.py` újra letölti a forrásokat, újraszámolja a szélességet, a szektorokat és a híreket, és összefésüli a történetet a meglévő `web/data/dashboard.json` fájllal. Egy forrás hibája nem állítja meg a többit.
