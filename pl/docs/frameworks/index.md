---
title: Integracja z frameworkami
description: Co się zmienia, gdy aplikacja Symfony, Laravel albo Yii3 działa na Rapirze — pętla workera, co jest świeże między żądaniami, co przeżywa i jakie pułapki przynosi ze sobą rezydentny proces PHP.
---

# Integracja z frameworkami

Postawienie aplikacji frameworkowej na Rapirze nie jest portowaniem. W trybie klasycznym to nawet nie zmiana: wskazujesz serwerowi front controller, który już masz, i to po prostu działa. Ciekawie robi się w workerze, gdzie proces PHP zostaje przy życiu między żądaniami — i to tam framework zaczyna mieć własne zdanie. Ta strona to wspólna połowa opowieści: mechanika, która wygląda tak samo w każdym frameworku. Trzy przewodniki po poszczególnych frameworkach zakładają, że masz ją już za sobą, i opisują wyłącznie to, co swoiste dla nich.

::: info Sprawdzone na

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.6.0**
- **Symfony 7.4.15** i **8.1.2**, **Laravel 13.23.0**, **Yii3** szablon aplikacji 1.4 (yii-runner-http 3.2.1)

Wszystko, co znajdziesz na tej stronie, zostało zaobserwowane na tych aplikacjach uruchomionych na Linuksie, na jednym procesie workera. Jeśli któreś stwierdzenie jest niewygodne, znalazło się tu dlatego, że je zmierzyliśmy, a nie dlatego, że dobrze brzmiało.
:::

## Co znaczy uruchomienie frameworka na Rapirze

**W trybie klasycznym nie zmienia się nic.** Skryptem wejściowym jest twój front controller, Rapira wykonuje go od zera przy każdym żądaniu i działa tu każdy framework, który działa pod php-fpm — łącznie z tymi, których stan nigdy nie przeżyłby drugiego żądania. Jeśli właśnie stamtąd zaczynasz, twoją stroną jest [tryb klasyczny](/pl/docs/classic); z tej dotyczą cię już tylko trzy ostatnie sekcje — brak plików statycznych, TLS i OPcache.

**Na szczeblu SAPI Worker proces zostaje przy życiu.** Twój skrypt raz podnosi aplikację, a potem kręci się w pętli i prosi Rapirę o kolejne żądanie. Framework przestaje być rozbierany między żądaniami — to w jednym zdaniu cały zysk i całe ryzyko, a reszta tej strony mówi o tym, co z tego wynika. [Tryby wykonania](/pl/docs/execution-modes) umieszczają ten szczebel na drabinie, a [tryb workera](/pl/docs/worker) opisuje jego API.

## Pętla linijka po linijce

Każdy skrypt workera ma ten sam kształt, niezależnie od tego, jaki framework siedzi w środku:

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());
$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Czytając od góry:

- **`require .../vendor/autoload.php`** — autoloader rejestruje się raz na całe życie workera, a każda klasa, którą rozwiąże, zostaje potem załadowana. Już samo to jest większością tego, co tu kupujesz.
- **`create_plugin_handler(new HttpHandlerConfig())`** — prosi Rapirę o handler; o wyborze wtyczki decyduje *klasa* obiektu konfiguracji. W trybie klasycznym rzuca wyjątek, bo nie ma tam rezydentnej pętli, której można by ten handler oddać.
- **`$app = new App();`** — twój rozruch, opłacony raz przy starcie. To w tej linii trzy przewodniki po frameworkach różnią się między sobą — i w niczym więcej: rezydentny kernel ląduje tutaj, aplikacja budowana na każde żądanie już nie.
- **`$handler = static function () use ($app): void`** — handler nie przyjmuje żadnych argumentów. Żądanie siedzi w superglobalach, a wszystko inne, czego potrzebuje, przechwytuje przez `use`.
- **`header()`, `http_response_code()`, `echo`** — odpowiedź tworzysz dokładnie tak samo jak w klasycznym skrypcie. Jak to zamienia się w bajty lecące po sieci, opisuje [HTTP](/pl/docs/http).
- **`while ($http->handleRequest($handler))`** — `handleRequest()` blokuje wykonanie, dopóki nie przyjdzie żądanie, wypełnia nim superglobale, uruchamia twój handler, zamyka żądanie i zwraca `true`. Kiedy serwer się zamyka, zwraca `false` — i tak właśnie kończy się pętla.
- **`gc_collect_cycles();`** — ciało pętli wykonuje się *między* żądaniami. To miejsce na pracę, która ma się wydarzyć w przewidywalnym momencie, a nie w środku obsługi czyjegoś żądania. To higiena dla zwykłych cykli, a nie lekarstwo na pamięć — zobacz [Pamięć i recykling](#pamiec-i-recykling).

Zanim usiądziesz do pisania tego pliku, warto wiedzieć jeszcze jedno: skryptem wejściowym jest `worker.php`, więc `SCRIPT_NAME` to `/worker.php`, `DOCUMENT_ROOT` to katalog, w którym ten plik leży, a ścieżkę, o którą naprawdę poprosił klient, niesie `REQUEST_URI`. Wszystkie trzy frameworki trasowały i generowały adresy URL na tej podstawie poprawnie, bez najmniejszego łatania `$_SERVER`.

## Co jest świeże, a co przeżywa

To ta tabela, którą warto mieć w głowie. Lewa kolumna: Rapira odbudowuje to przy każdym żądaniu, więc zwykły kod PHP, który stamtąd czyta, działa dalej. Prawa kolumna: od teraz to twoja sprawa.

| Świeże przy każdym żądaniu | Przeżywa każde żądanie |
| -------------------------- | ---------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` — wypełnione na nowo danymi tego żądania | Autoloader Composera i każda klasa już przez niego wczytana |
| `php://input` — surowa treść tego żądania, a obok niej `CONTENT_TYPE` i `CONTENT_LENGTH` | Właściwości i zmienne `static`, które liczą dalej przez kolejne żądania |
| `$_FILES` i stojące za nim tymczasowe pliki wysłane przez klienta | Obiekty utworzone przed pętlą — kontener, kernel, twoja aplikacja |
| Obsługa sesji: `session_start()`, ciasteczko na wejściu, `Set-Cookie` na wyjściu | Otwarte zasoby: uchwyty do bazy, klienty cache'a, strumienie |
| Stan odpowiedzi: kod statusu, nagłówki, `setcookie()`, bufory wyjścia | Sam proces — ten sam pid, jeden rezydentny interpreter PHP na workera |
| Funkcje shutdown zarejestrowane **wewnątrz** handlera | Własne liczniki workera: `handled` i `errors` rosną dalej |
| Zegar `max_execution_time`, uzbrajany na nowo przy każdym żądaniu | |

Wiersz o `max_execution_time` wymaga jednego dopowiedzenia. Na Linuksie (i na FreeBSD), gdzie zendowy licznik czasu żądania w ogóle istnieje, zegar jest uzbrajany na nowo przy każdym żądaniu, a czas, który worker spędza zaparkowany w oczekiwaniu na kolejne, nigdy się do niego nie wlicza — na zegarze tyka wyłącznie samo żądanie. Wszędzie indziej, macOS w to wliczając, żaden limit czasu żądania nie jest uzbrajany w ogóle.

Trzy rzeczy zachowują się tak, że ludzi to zaskakuje. Wszystkie trzy są sprawdzone, wszystkie trzy gryzą na etapie rozruchu i wszystkie trzy są cechą rezydentnego PHP, a nie Rapiry.

::: warning Destruktor rezydentnego obiektu odpala się na końcu pierwszego żądania

Daj obiektowi utworzonemu *poza* pętlą `__destruct` napisany w PHP, a ten się wykona — raz, na końcu **pierwszego** żądania, kiedy PHP przy zamykaniu żądania przechodzi po swoim magazynie obiektów. Samemu obiektowi nic się przy tym nie dzieje: dalej jest obiektem, metody dalej można wywoływać, a destruktor już nigdy się nie odpali — ani przy kolejnych żądaniach, ani przy zamykaniu workera.

Klasa, która w destruktorze zamyka uchwyt, opróżnia bufor albo dopisuje pożegnalną linię do logu, zrobi to więc raz, wcześnie i za twoimi plecami — a potem już nigdy przez całe życie procesu. Ze wszystkiego, co trzymasz rezydentnie, wynieś sprzątanie poza destruktor.
:::

::: warning `register_shutdown_function()` w rozruchu odpala się raz i nigdy więcej

Wywołana poza handlerem, funkcja zwrotna wykona się na końcu pierwszego żądania i zostanie zwolniona. Drugie żądanie już jej nie uruchomi, tysięczne również. Zarejestrowana *wewnątrz* handlera zachowuje się dokładnie tak jak pod php-fpm: wykonuje się na końcu tego żądania, i tak przy każdym.

Jeśli twój rozruch instaluje handler shutdown — żeby wypchnąć metryki, złapać błąd krytyczny albo coś domknąć — zarejestruj go zamiast tego w środku handlera, przy każdym obrocie pętli.
:::

::: warning `$_ENV` po cichu importuje się na nowo w środku żądania

Przy domyślnych ustawieniach ini (`variables_order = "GPCS"`, `auto_globals_jit = On`) PHP przy każdym żądaniu uzbraja na nowo flagę JIT dla `$_ENV`. Pierwszy skompilowany w trakcie tego żądania plik, w którym pada `$_ENV`, każe PHP odbudować superglobal — a skoro w `variables_order` nie ma `E`, nie ma czego importować, więc `$_ENV` wraca **puste** i wszystko, co rozruch w stylu Dotenva wpisał do niego przy starcie workera, znika w środku żądania, bez ostrzeżenia i bez błędu.

Paskudne jest to, że wszystko zależy od tego, *kiedy* dany plik zostanie skompilowany. Konfiguracja, którą framework rozwiązuje zachłannie już podczas rozruchu, siedzi w cache'u i wygląda całkiem zdrowo; to, co rozwiązuje się leniwie, przy pierwszym żądaniu, czyta `$_ENV` opróżnione chwilę wcześniej. Dokładnie z tego powodu ta sama aplikacja bywa w jednym środowisku zielona, a w drugim odpowiada `500` na każde żądanie.

Wyjścia są dwa. Pierwsze jest sprawdzone: niech rozruch zapisze te wartości również do prawdziwego środowiska — `putenv()` przeżywa ponowny import, a framework, który spada z powrotem na `getenv()`, wtedy je znajdzie. Drugie i tak jest na produkcji lepszą odpowiedzią: ustaw prawdziwe zmienne środowiskowe w jednostce usługi albo w kontenerze i przestań parsować `.env` w czasie działania. Żadne z nich nie wstawia niczego z powrotem do `$_ENV` — pod `GPCS` zostaje ono puste bez względu na to, skąd wzięło się środowisko, a wartości widzi `getenv()`. Konkretną awarię i jednolinijkową poprawkę pokazuje [przewodnik po Symfony](/pl/docs/frameworks/symfony).

To nie jest dziwactwo Rapiry. Trafia na to każde środowisko uruchomieniowe PHP, które trzyma proces przy życiu między żądaniami.
:::

## Kiedy coś idzie nie tak

Trzy rodzaje awarii, wszystkie obejrzane na jednym workerze z pilnowanym pidem:

- **`exit` albo `die` w handlerze** — odpowiedź trafia do klienta razem ze statusem i tym, co zdążyło powstać z treści, a worker obsługuje dalej. Frameworki robią tak częściej, niż można by przypuszczać (sprawdzenie trybu konserwacji w Laravelu kończy się właśnie na `exit`), więc to, że nie jest to zabójcze dla procesu, ma znaczenie.
- **Nieprzechwycony wyjątek** — `500`. W praktyce łapie go najpierw handler błędów twojego frameworka i rysuje własną stronę błędu; jeśli nie zrobi tego nic, Rapira odpowiada `500` z pustą treścią. Tak czy inaczej worker obsługuje dalej.
- **Nieprzechwycony `Error`** — na przykład wywołanie funkcji, która nie istnieje. PHP zapisuje to w logu jako `Uncaught Error`, a dalej idzie tą samą drogą co każdy inny nieprzechwycony throwable — `500`, i worker obsługuje dalej na tym samym pidzie.

Licznik `errors` workera rośnie przy obu wariantach błędu; żądanie z `exit` to zwykłe `200` i rusza wyłącznie `handled`. We wszystkich trzech przypadkach `recycles` i `restarts` zostają na zerze: nieprzechwycony throwable nie kładzie workera i nie dotyka następnego żądania. Warto o tym wiedzieć, zanim w panice rzucisz się do logu błędów. Więcej dzieje się tylko przy błędzie krytycznym klasy bailout — zwija on rezydentny skrypt, więc worker uruchamia go od góry i jeszcze raz podnosi twoją aplikację, a właśnie to zlicza `recycles`. Te liczniki odczytasz z PHP przez `getInfo()` opisane na stronie [tryb workera](/pl/docs/worker).

## Rapira nie serwuje niczego z dysku

Nie ma tu ani szukania pliku w document roocie, ani reguły „oddaj plik, jeśli istnieje”. Jakikolwiek byłby adres URL, uruchamia się twój skrypt wejściowy, a `$_SERVER['REQUEST_URI']` mówi aplikacji, dokąd chciał trafić klient — układ ten sam, co przy regule nginx przepisującej wszystko na `index.php`, tyle że bez reguły, i identyczny w trybie klasycznym oraz w workerze.

To znaczy, że twoje zasoby statyczne potrzebują czegoś przed Rapirą: CDN-a albo reverse proxy, które stawia [wdrożenie produkcyjne](/pl/docs/deployment). Zbundlowany JS i CSS, obrazki, favicon — inaczej każde z nich jest żądaniem do PHP.

## TLS i proxy

Nasłuch Rapiry mówi nieszyfrowanym HTTP, a w konfiguracji nie ma żadnej sekcji od TLS-a. Zakończ TLS na proxy, które i tak już masz, i pozwól mu dobić do Rapiry po loopbacku albo po unixowym gnieździe; jedyny obowiązek proxy na wejściu to zapisywanie przekazywanych pól z `-`, nigdy z `_`, bo obie pisownie schodzą się pod tym samym kluczem `$_SERVER`. To mapowanie wyjaśnia [HTTP](/pl/docs/http), a przepis na proxy ma [wdrożenie produkcyjne](/pl/docs/deployment).

## Pamięć i recykling

Jeśli twój worker odbudowuje aplikację wewnątrz handlera — a tego dziś wymaga Laravel i tak działa prostszy z dwóch wariantów Yii3 — każde żądanie zostawia po sobie porzucony graf obiektów. PHP nie zwalnia ich po kolei. Spinają je cykle referencji, więc sterta rośnie żądanie po żądaniu, aż odpali się kolektor cykli i zabierze naraz dużą partię: to piłokształtny wykres, a nie wyciek — tyle że szczyty tej piły leżą sporo wyżej niż ślad pamięciowy pojedynczego żądania.

Samodzielne wywołanie `gc_collect_cycles()` tego nie wypłaszcza — sprawdzone, i w pętli, i w środku handlera. Stare grafy pozostają silnie referencjonowane, dopóki nie zwolni ich kolejny rozruch, więc kolektor naprawdę nie ma jeszcze czego zabrać. Wynikają z tego dwie rzeczy. Daj `memory_limit` realny zapas, bo zmieścić musi się szczyt, a nie średnia. I ustaw budżet na recykling:

```toml
[pool]
max_requests = 100
```

Po tylu żądaniach worker kończy pracę (plus niewielki rozrzut, żeby pula nie wymieniała się równym krokiem), a proces nadrzędny forkuje następcę startującego ze świeżą stertą. Sprawdzone na setkach kolejnych żądań, przez kilka wymian: workery się rotują, pamięć zeruje się przy każdym cyklu, a ani jedno żądanie nie zostało zgubione ani nie dostało odpowiedzi innej niż `200`. To deterministyczna siatka pod wzorcem, którego profil pamięciowy w innym razie należy wyłącznie do kolektora.

Warianty rezydentne — kernel Symfony, kontener Yii3 za `StateResetter` — są przy tym płaskie: w tych samych przebiegach pamięć trzymała poziom. Recykling i tak warto mieć jako siatkę. Klucz opisuje [Konfiguracja](/pl/docs/configuration), a to, co recykling robi z pulą — [model procesów](/pl/docs/process-model).

## OPcache i zmieniony kod

Rapira uruchamia PHP dokładnie raz, w procesie nadrzędnym, zanim sforkuje choćby jednego workera — dzięki temu OPcache tworzy swój segment pamięci współdzielonej jeden jedyny raz, a każdy worker dziedziczy to samo mapowanie. Skompilowane skrypty zostają rozgrzane między żądaniami *i* w obrębie całej puli, w obu trybach. Worker, który ponownie dołącza pliki twojego frameworka, nie parsuje ich od nowa.

Na produkcji `opcache.validate_timestamps = 0` zdejmuje `stat` na każdym pliku przy każdym żądaniu. Cena jest taka, że nic już nie unieważnia cache'u: segment należy do procesu nadrzędnego i przeżywa każde pokolenie workerów, więc przeładowanie kroczące dalej serwowałoby stare opcode'y, a wdrożenie wymaga pełnego restartu. Kolejność kroków opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

Przy pracy nad kodem spodziewaj się tego samego efektu, tyle że z innego powodu. Rezydentny rozruch nigdy nie czyta ponownie kodu wczytanego przy starcie, cokolwiek robi OPcache — popraw serwis, który kontener już zbudował, albo sam skrypt workera, a działający proces tego nie zauważy. Restartuj po każdej zmianie, a nigdy nie będzie trzeba się zastanawiać, który z tych dwóch powodów akurat zadziałał: `rapira serve` działa na pierwszym planie i nigdy nie ucieka w tło, więc wystarczy Ctrl-C i uruchomienie od nowa.

## Wybierz swój framework

- **[Symfony](/pl/docs/frameworks/symfony)** — kernel podnosi się raz i zostaje rezydentny, a własny `services_resetter` frameworka przywraca między żądaniami usługi ze stanem do postaci, w jakiej je zastał. Jeden plik workera obsługuje 7.4 i 8.1, bajt w bajt.
- **[Laravel](/pl/docs/frameworks/laravel)** — świeża aplikacja na każde żądanie, bo dziś to uczciwa odpowiedź: rezydentna aplikacja to w Laravelu historia Octane'a, a Rapira nie ma sterownika do Octane'a. Zostaje ci rozgrzany autoloader i gorący OPcache; kontener już nie.
- **[Yii3](/pl/docs/frameworks/yii3)** — rezydentny kontener zerowany przy każdym żądaniu przez `StateResetter`, czyli własny pomysł Yii3 na długo żyjące procesy (jego runner do RoadRunnera ma ten sam kształt), albo prostszy wariant ze świeżym runnerem na każde żądanie, jeśli wolisz zacząć od niego.

::: question Mój framework to żaden z tych trzech. Czy i tak mogę go uruchomić?
Prawdopodobnie tak. Skrypt workera to kilkanaście linijek, a jedyne realne pytanie brzmi: czy twoja aplikacja zniesie to, że każesz jej obsłużyć drugie żądanie. Zacznij od odbudowywania jej wewnątrz handlera — tak wygląda wariant Laravela i nie wymaga on od frameworka niczego — a potem wynoś kolejne rzeczy poza handler, w miarę jak odkrywasz, co da się bezpiecznie zatrzymać. Jeśli nie zniesie ani jednego, ani drugiego, [tryb klasyczny](/pl/docs/classic) uruchomi ją bez zmian.
:::

::: question Czy to, że skryptem wejściowym jest `worker.php`, psuje generowanie adresów URL?
U żadnego z tych trzech nie zepsuło. `SCRIPT_NAME` to `/worker.php`, a prawdziwą ścieżkę niesie `REQUEST_URI` — i Symfony, Laravel oraz Yii3 trasowały poprawnie i generowały czyste adresy bez `worker.php` w środku, bez nadpisywania czegokolwiek w `$_SERVER`. Jeśli twój własny framework buduje adresy URL na podstawie `SCRIPT_NAME`, to jest pierwsza rzecz do sprawdzenia.
:::

::: question Czy rozruch na każde żądanie jest naprawdę lepszy niż tryb klasyczny?
Tak, choć nie tak spektakularnie jak rezydentna aplikacja. Autoloader i każda wczytana już klasa zostają w pamięci, zamiast powstawać od nowa za każdym razem, a pętla należy do ciebie — możesz więc kawałek po kawałku wynosić pracę poza handler, w miarę jak sprawdzasz, co przeżywa. Nie dostajesz za to głównej nagrody: kontenera zbudowanego, zanim jeszcze przyszło żądanie.
:::

::: question Czy jedna baza kodu może działać w obu trybach?
Tak, i to właśnie rozsądny sposób na przesiadkę: zostaw `public/index.php` dokładnie takim, jaki jest, i dołóż obok `worker.php`. Wszystkie trzy sprawdzone aplikacje mają oba pliki. O tym, który się uruchomi, decyduje flaga — `rapira serve --classic public/index.php` albo `rapira serve worker.php` — więc tryb klasyczny zostaje pod ręką jako droga odwrotu, dopóki nie oswoisz się z workerem.
:::
