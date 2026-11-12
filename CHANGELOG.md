# Muutosloki

Kaikki merkittävät muutokset kirjataan tähän tiedostoon. Muoto noudattaa
[Keep a Changelog](https://keepachangelog.com/fi/1.1.0/) -käytäntöä.

## [Unreleased]

### Lisätty
- README on käännetty kokonaan englanniksi (sisällysluettelon ankkurit päivitetty). Korjattu kaksi koodin vastaista väitettä: Bearer-tunnistus ajetaan ennen JSON-jäsennystä (README väitti päinvastaista), ja mitatun vertailun tulkinta vastaa nyt taulukkoa (`qwen3-coder` oli yleinen-tehtävätyypissä hitaampi ja kalliimpi, muissa tyypeissä nopeampi ja halvempi).
- README: englanninkielinen osio "Quick start from npm" (asennus, `config.example.yaml`:n kopiointi paketista ja käynnistys `CONFIG_PATH`:lla).

### Muutettu
- Puuttuvan asetustiedoston virhe on englanniksi, kertoo absoluuttisen polun ja korjauksen eikä tulosta pinojälkeä. Poistumiskoodi on edelleen 1.

### Korjattu
- `provider.timeoutMs` ja `tasks.<tyyppi>.timeoutMs` hyväksyivät minkä tahansa positiivisen kokonaisluvun. Yli 2 147 483 647 ms:n arvolla Noden `setTimeout` asettaa ajastimen 1 ms:iin, joten jokainen mallikutsu aikakatkaistiin heti ja varasi silti päiväbudjettia. Nyt asetuksen lataus hylkää arvon, ja `callChatCompletion` hylkää virheellisen aikakatkaisun ennen budjettivarausta ja kutsua.
- Asetustiedoston `${NIMI}`-korvaus lisää ympäristömuuttujan arvon kirjaimellisena. Aiemmin arvo jäsennettiin uudelleen, joten esim. API-avain tai salasana, jossa on `${...}`, muuttui hiljaa, ja arvo `a${X}` muuttujassa `X` jumitti käynnistyksen ikuiseen silmukkaan.
- HTTP-tila: Bearer-tunnistus ajetaan ennen JSON-jäsennystä. Tunnistamattoman pyynnön bodya ei enää lueta, joten virheellinen JSON tai liian suuri body antaa 401:n eikä Expressin HTML-virhesivua pinojälkineen. Tunnistetun pyynnön jäsennysvirhe palauttaa JSON-RPC-virheen `-32700 Parse error` (katselmointi 28.10., löydös 9). DNS rebinding -suoja (Host-otsakkeen tarkistus) toimii kuten ennen.
- HTTP-tila: pyyntökohtainen `McpServer` ja transport suljetaan nyt myös, kun `connect` tai `handleRequest` heittää tai yhteys sulkeutuu kesken käsittelyn; aiemmin ne jäivät auki (löydös 8).
- `run_eval`: LLM-tuomarin pisteiden poiminta ei enää lue ensimmäistä numeroa 1-5 mistä tahansa tekstistä. Vastaukset kuten "10/10" tai "vuonna 2024" eivät enää anna pisteitä 1 tai 2; epäselvä vastaus jättää pisteen pois sen sijaan, että vääristäisi keskiarvoa (katselmointi 28.10., löydös 10).
- `run_eval`: tuomarikutsun virheet (myös `LimitExceededError`) eivät enää katoa hiljaa. Tapauskohtainen `judgeError` ja mallikohtainen `judgeErrorCount` kertovat, miksi piste puuttuu.
- `run_eval`: tuomarikutsu varaa oletuksena 64 tokenia 4096:n sijaan (uusi valinnainen `eval.judge.maxTokens`, enintään kutsukohtainen katto 4096).
