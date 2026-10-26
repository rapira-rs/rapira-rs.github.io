---
title: "PHP2Shell i RoadRunner"
date: 2026-10-27
description: "Dlaczego podatności PHP2Shell (CVE-2026-109618 i CVE-2026-109619) nie dotyczą RoadRunnera, jak inne serwery uruchamiają PHP i co zrobić, jeśli masz WordPressa."
author: Aleksei Gagarin
image: /blog/php2shell/preview.jpg
---

21 października zespół PHP opublikował nieplanowane wydania 8.5.12, 8.4.27, 8.3.36 i 8.2.35. Łatają one dwie krytyczne podatności, które ich odkrywcy nazwali [PHP2Shell](https://calif.io/php2shell/): [CVE-2026-109618](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) i [CVE-2026-109619](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp). Obie pozwalają na zdalne wykonanie kodu bez uwierzytelniania, a ich ocena CVSS v4 wynosi 9.2. Badacze zademonstrowali atak na WordPressa, Drupala, Joomlę, Magento, Nextclouda, Laravela, Symfony i inne aplikacje.

Najciekawsze w tych podatnościach jest to, gdzie się kryją. To nie kod frameworków ani nowe funkcje języka, tylko serwerowa część samego PHP: parsowanie treści żądania POST i przesyłanie plików. Plik `main/rfc1867.c`, który parsuje `multipart/form-data`, trafił do repozytorium w 1999 roku, a `main/php_variables.c` w 2000.

::: warning
Zaktualizuj PHP, niezależnie od tego, jakiego serwera używasz. Poniżej wyjaśniamy, dlaczego niektóre sposoby uruchamiania PHP ucierpiały bardziej niż inne. To jednak nie powód, by odkładać aktualizację.
:::

## Jak działa atak

Wszystkie warianty ataku opierają się na tym samym pomyśle. Atakujący doprowadza do tego, że PHP pada z fatal errorem w chwili, gdy struktury w pamięci są wypełnione tylko częściowo. Najczęściej służy do tego żądanie, które zużywa więcej niż `memory_limit`. Nadają się głęboko zagnieżdżone pola formularza w `multipart` albo treść bez zadeklarowanej długości: chunked w HTTP/1.1 lub HTTP/2 bez `Content-Length`. Kontrola `post_max_size` bierze pod uwagę zadeklarowaną długość i przepuszcza takie dane.

Calif opisuje trzy ścieżki ataku:

1. **Parsowanie POST.** Pamięć kończy się, gdy PHP na starcie żądania parsuje treść `application/x-www-form-urlencoded` lub `multipart/form-data`. W tablicy haszującej zostaje element, który jest już uwzględniony, ale którego klucz nie został jeszcze utworzony.
2. **`session.upload_progress`.** Część `multipart` z plikiem uruchamia sesję jeszcze w trakcie parsowania treści. Fatal error przerywa start żądania i sesja nie zostaje zamknięta. Jej dane wskazują na pamięć, która została już zwolniona.
3. **Dekodowanie po starcie.** Fatal error występuje w `unserialize()`, `session_decode()` lub `session_start()`, gdy żądanie już wystartowało i wykonuje się kod aplikacji. Stan dekodera nadal wskazuje na zwolnioną pamięć. Ta ścieżka zależy od aplikacji: musi ona dekodować dane kontrolowane przez atakującego.

We wszystkich trzech przypadkach uszkodzony stan sam w sobie jest nieszkodliwy. W wykonanie kodu zamienia go następne żądanie, które trafi do tego samego procesu. Atak działa tylko wtedy, gdy proces PHP przeżyje fatal error. Dlatego niemal wszystko zależy od tego, jak serwer uruchamia PHP i przekazuje mu żądanie.

## Jak serwery komunikują się z PHP

| Serwer                   | Jak uruchamia PHP          | Kto parsuje treść żądania | Czy proces przeżywa fatal error                                                | Wynik dla PHP2Shell             |
|--------------------------|----------------------------|---------------------------|--------------------------------------------------------------------------------|---------------------------------|
| Apache + mod_php         | Moduł wewnątrz Apache'a    | PHP                       | Tak                                                                            | Podatny, wszystkie trzy ścieżki |
| PHP-FPM                  | Osobne procesy, FastCGI    | PHP                       | Przy błędzie na starcie żądania — nie, przy błędzie w kodzie aplikacji — tak   | Podatny, ścieżka 3              |
| FrankenPHP               | Wbudowany w serwer w Go    | PHP                       | Tak, jak mod_php                                                               | Na liście zagrożonych           |
| Swoole                   | Rozszerzenie PHP           | Swoole                    | Nie                                                                            | Niepodatny                      |
| RoadRunner               | Osobne procesy PHP         | Go                        | Nie, RoadRunner uruchamia nowy proces                                          | Niepodatny                      |
| Rapira [Classic, Worker] | Wbudowany w serwer w Rust  | PHP                       | Tak, restartowana jest tylko aplikacja                                         | Te same warunki co mod_php      |
| Rapira [Dispatcher]      | Wbudowany w serwer w Rust  | Rust                      | Tak, restartowana jest tylko aplikacja                                         | Ścieżki 1 i 2 nie działają      |

**mod_php** ucierpiał najbardziej: Calif pokazuje RCE na dowolnym skrypcie PHP przy ustawieniach domyślnych.

**PHP-FPM** kończy workera, jeśli start żądania się nie powiódł. Dlatego ścieżki 1 i 2, które psują start żądania, na FPM nie działają. Ścieżka 3 działa: fatal error w dekoderze występuje już po starcie, więc worker pozostaje przy życiu. Calif w swojej demonstracji używa właśnie nginx i PHP-FPM.

**FrankenPHP** osadza PHP jako osobne SAPI i wywołuje standardowe `php_request_startup()`, więc treść żądania parsuje sam PHP. Zespół PHP wpisał FrankenPHP na listę zagrożonych serwerów. W advisory zaznaczono, że FrankenPHP wywołuje zakończenie żądania nawet po nieudanym starcie, tak jak mod_php. FrankenPHP jeszcze tego samego dnia wydał [v1.13.2](https://github.com/php/frankenphp/releases) z poprawionym PHP.

**Swoole** parsuje HTTP i `multipart` własnym kodem i nie obsługuje `session.upload_progress`. Maintainerzy Swoole [oświadczyli](https://github.com/swoole/swoole-src/issues/6343), że te CVE nie dotyczą Swoole.

**RoadRunner** również parsuje HTTP poza PHP, a worker po fatal errorze kończy działanie. Żadna z trzech ścieżek ataku tu nie działa. Dlaczego? Przyjrzyjmy się temu bliżej.

## Jak RoadRunner komunikuje się z PHP

RoadRunner nie osadza w sobie PHP i nie korzysta z FastCGI. Worker to zwykły proces `php worker.php`, który działa w CLI SAPI. RoadRunner i worker wymieniają ramki protokołu [Goridge](https://github.com/roadrunner-server/goridge) przez STDIN/STDOUT lub socket. Każda ramka to nagłówek z długością i sumą kontrolną, po którym następują dane.

Całe żądanie HTTP obsługuje plugin http RoadRunnera. Przyjmuje połączenie, sprawdza `max_request_size`, parsuje `application/x-www-form-urlencoded` i `multipart/form-data` oraz zapisuje przesłane pliki w katalogu tymczasowym. PHP dostaje gotowe DTO: kontekst żądania (metodę, URI, nagłówki, cookies, sparsowane pola, listę przesłanych plików) i treść. Pakiet PHP `roadrunner/http` buduje z niego żądanie PSR-7.

Co to oznacza dla PHP2Shell:

- Ścieżka 1: `rfc1867_post_handler()` i `php_std_post_handler()` nie widzą żądań HTTP. Worker CLI startuje raz i bez treści żądania.
- Ścieżka 2: `session.upload_progress` się nie wykonuje.
- Ścieżka 3: fatal error kończy skrypt CLI, a razem z nim cały proces. RoadRunner widzi, że worker zakończył działanie, i uruchamia nowy. Uszkodzony stan nie przetrwa do następnego żądania.

Dwudziestoletni kod parsowania żądań w PHP w tym modelu po prostu się nie uruchamia. Potoki pojawiły się w Uniksie już w 1973 roku i od tamtej pory nikomu nie udało się ich zepsuć. Między RoadRunnerem a PHP nie ma współdzielonej pamięci, współdzielonych wątków ani sprytnych hooków w silniku, tylko bajty w rurze. Jeśli proces PHP padnie, RoadRunner po prostu uruchamia nowy, a następne żądanie trafia już do czystego procesu.

Już wcześniej mówiliśmy, że pod względem niezawodności RoadRunner nie ustępuje PHP-FPM. Historia z PHP2Shell pokazała, że pod względem bezpieczeństwa wręcz go wyprzedza: tam, gdzie FPM trzeba było pilnie aktualizować, RoadRunner po prostu nie uruchamia podatnego kodu. I to z pewnością jeszcze nie koniec tej historii.

::: info
PHP i tak warto zaktualizować: poprawka zmienia zachowanie PHP przy braku pamięci.
:::

## Nieśmiertelna aplikacja

Ta architektura ma swoją cenę: aplikacja musi umieć działać w długo żyjącym procesie. Worker ładuje framework raz, a potem obsługuje żądania w pętli. Właściwości statyczne, singletony i stan globalny przeżywają żądanie, więc kod nie powinien przechowywać w nich danych żądania.

WordPress tak nie potrafi. Za to aplikacje na Symfony, Laravelu i Yii3, o ile nie korzystają bezmyślnie ze statyki, najpewniej przejdą na RoadRunnera bezboleśnie dzięki gotowym bridge'om:

- Symfony — [Symfony Runtime](https://github.com/php-runtime/runtime) lub [baldinof/roadrunner-bundle](https://github.com/baldinof/roadrunner-bundle);
- Laravel — [Laravel Octane](https://laravel.com/docs/octane) lub [spiral/roadrunner-laravel](https://github.com/spiral/roadrunner-laravel);
- Yii3 — [yiisoft/yii-runner-roadrunner](https://github.com/yiisoft/yii-runner-roadrunner).

::: info
A jeśli zaczynasz nowy projekt, przyjrzyj się naszemu frameworkowi [Spiral](https://spiral.dev/). Od początku powstawał z myślą o RoadRunnerze i działa w długo żyjącym procesie bez bridge'ów i kompromisów. Spiral od razu w pełni wykorzystuje możliwości RoadRunnera: HTTP, gRPC, kolejki, magazyny key-value, WebSocket przez Centrifugo, Temporal i metryki.
:::

## Ale ja mam WordPressa!

Nasz nowy projekt [Rapira](/pl/docs/intro/) to kolejny krok po RoadRunnerze. Piszemy go w Ruście z rozwagą i nie zdajemy się we wszystkim na AI. Architektura samej Rapiry i jej kontraktów PHP, przez które aplikacja komunikuje się z serwerem, przechodzi kilka rund przeglądów i benchmarków, zanim trafi do wydania. Rapira uruchamia PHP w jednym z [trzech trybów](/pl/docs/execution-modes): Classic, Worker i Dispatcher.

**Classic** sprawdza się przy WordPressie i starszych bazach kodu. Skrypt wykonuje się od nowa przy każdym żądaniu, jak w php-fpm, i aplikacji nie trzeba przepisywać. Rapira obsługuje PHP 8.4 i 8.5, więc migracja na PHP 8.4+ i tak będzie konieczna.

**Worker** trzyma aplikację w pamięci i przy każdym żądaniu wypełnia zmienne superglobalne. To model trybu worker z FrankenPHP, ale bez CGO i bez wątków ZTS: każdy worker to osobny proces z jednym interpreterem NTS.

**Dispatcher** to najwydajniejszy tryb. Działa jak RoadRunner: aplikacja dostaje obiekt żądania zamiast zmiennych superglobalnych, a `multipart` parsuje sam Rust. W odróżnieniu od RoadRunnera nie ma tu jednak warstwy pośredniej w postaci Goridge i serializacji, a wszystkie workery współdzielą OPcache procesu głównego (master).

Benchmarki Yii3 na różnych serwerach, w tym we wszystkich trzech trybach Rapiry, znajdziesz na [yii3-benchmarks.github.io](https://yii3-benchmarks.github.io/app-api/).

::: warning PHP2Shell i Rapira
Część niebezpiecznych żądań Rapira odrzuca jeszcze przed uruchomieniem PHP. Rapira buforuje całą treść i odpowiada `413`, jeśli jest ona większa niż `http.max_body_size_mb`. Dlatego obejście `post_max_size` za pomocą treści chunked w HTTP/1.1 i przez HTTP/2 bez `Content-Length` nie zadziała.

Jednak w trybach Classic i Worker treść żądania parsuje sam PHP. Pozostaje więc wektor ataku przez zagnieżdżone pola `multipart`: taka treść mieści się w limicie rozmiaru, ale przy parsowaniu zajmuje więcej niż `memory_limit`.
:::

Staraj się pisać aplikację tak, żeby działała w trybie Dispatcher. Poprawisz w ten sposób nie tylko wydajność aplikacji, ale też jej niezawodność i bezpieczeństwo. To podejście możesz wypróbować już teraz na superstabilnym RoadRunnerze.

A w ostateczności zostaje środek radykalny: `pm.max_requests = 1` w PHP-FPM albo `max_jobs: 1` w puli RoadRunnera. Każde żądanie dostanie świeży proces, zupełnie jak w CGI anno 1997. Niby to żart, ale z bezpieczeństwem nie ma żartów.

## Podsumowanie

PHP2Shell nie jest ostatnią podatnością tego rodzaju. Kod startu żądania, parsowania POST i przesyłania plików powstał w C ponad dwadzieścia lat temu, a w serwerowej części PHP jeszcze nieraz ktoś znajdzie błędy. Im mniej tego kodu stoi między siecią a Twoją aplikacją, tym mniejsza powierzchnia ataku. RoadRunner i tryb Dispatcher w Rapirze parsują HTTP poza PHP. A dla aplikacji, które potrzebują klasycznego PHP, główną ochroną pozostaje aktualizowanie PHP na bieżąco.
