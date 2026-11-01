# Piaci áttekintő

Egyoldalas, statikus műszerfal részvénykereskedőknek. A célja, hogy az amerikai zárás után egy pillantással látsszon a piac szélessége, a hangulat, a fő indexek és az amerikai hozamgörbe. Az oldal magyar nyelvű, sötét témájú, és GitHub Pagesre telepíthető. Nincs szerver, nincs előfizetés, nincs API-kulcs.

A számok nem befektetési tanácsok. Késleltetett, harmadik féltől származó adatok, a kereskedés előtt az elsődleges forrás a mérvadó.

## Mit jelent az egyes mutató

**Piaci szélesség.** Az S&P 500 és a Nasdaq-100 összetevői közül hány százalék zár a saját 50 és 200 napos mozgóátlaga felett. Magas érték széles emelkedést jelent, alacsony érték azt, hogy a részvények többsége gyenge, még ha az indexet néhány nagy papír tartja is.

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
