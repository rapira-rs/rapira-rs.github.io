---
title: Szybki start
description: Postaw pierwszą aplikację PHP na Rapirze — klasyczny front controller, ta sama aplikacja jako stale działający worker i pięciolinijkowy rapira.toml.
---

# Szybki start

Ta strona zaczyna się tam, gdzie kończy się [Instalacja](/pl/docs/installation): masz działający plik binarny `rapira` razem z dołączonym do niego PHP. Przez najbliższych kilka minut wystawisz stronę w trybie klasycznym, zamienisz tę samą aplikację w stale działający worker i przeniesiesz ustawienia do pliku konfiguracyjnego.

## Hello world w trybie klasycznym

Tryb klasyczny to szczebel dostępny dla każdej aplikacji: przy każdym żądaniu Rapira na nowo dołącza twój skrypt wejściowy — dokładnie tak, jak php-fpm uruchamia front controller. Kod nie wymaga przy tym żadnych zmian, więc to najlepszy punkt wyjścia.

Utwórz `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Uruchom serwer — tryb wybiera flaga `--classic`, a argument pozycyjny to skrypt wejściowy:

```bash
rapira serve --classic public/index.php
```

Bez dodatkowych ustawień Rapira nasłuchuje na `127.0.0.1:8000`. Z drugiego terminala:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

Proces nie ginie między żądaniami — Rapira raz forkuje swoje workery i w każdym z nich trzyma uruchomiony interpreter PHP. Znika za to stan twojego skryptu: zmienne, autoloader, wszystko, co zbudował framework. To kompromis trybu klasycznego i właśnie dlatego istnieje kolejny szczebel.

## Ta sama aplikacja jako stale działający worker

Szczebel SAPI Worker utrzymuje skrypt przy życiu. Startuje raz, a potem kręci się w pętli i prosi Rapirę o kolejne żądanie; Rapira wypełnia zmienne superglobalne i wywołuje twój handler. Kod PHP wygląda znajomo — nadal czytasz `$_GET` i wypisujesz odpowiedź przez `echo` — ale praca startowa wykonuje się raz na proces, a nie raz na żądanie. Całą drabinę opisują [Tryby wykonania](/pl/docs/execution-modes).

Utwórz `worker.php` w katalogu głównym projektu:

```php
<?php
use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());

// Outside the loop, so it survives every request this worker serves.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

`create_plugin_handler()` prosi serwer o handler obsługujący HTTP — wskazuje go `HttpHandlerConfig`. `handleRequest()` blokuje wykonanie aż do nadejścia żądania, uruchamia dla niego twój callback i zwraca `true`; gdy serwer się zamyka, zwraca `false` i to kończy pętlę.

Najpierw zatrzymaj serwer w trybie klasycznym — `Ctrl-C` w jego terminalu — bo oba zajmują `127.0.0.1:8000`. Tryb workera jest domyślny, więc tym razem obejdzie się bez flagi:

```bash
rapira serve worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Puść tego `curla` kilka razy: licznik rośnie, bo żądania obsługuje wciąż ten sam proces. Domyślnie Rapira forkuje po jednym workerze na rdzeń CPU, więc żądanie może trafić do dowolnego z nich — o tym, który je odbierze, decyduje jądro systemu — a każdy worker liczy po swojemu; pid w odpowiedzi mówi, który akurat odpowiedział. Jeśli wolisz jedną, uporządkowaną sekwencję, zacznij od `rapira serve --processes 1 worker.php`. O tym, jak nadzorowana jest pula, mówi [model procesów](/pl/docs/process-model).

Wszystko, co zbudujesz przed pętlą `while`, zostaje w pamięci przez całe życie workera: autoloader Composera, kontener DI, połączenia z bazą i cache'em, skompilowane trasy i szablony — za to wszystko płacisz raz, przy starcie, a nie przy każdym żądaniu. Od nowa powstaje tylko stan związany z konkretnym żądaniem.

::: warning
Stan, który zostaje między żądaniami, staje się twoją odpowiedzialnością. Statyczna właściwość, zmienna globalna czy otwarta transakcja zostawiona przez jedno żądanie czekają na następne. [Tryb workera](/pl/docs/worker) opisuje, na co uważać i jak utrzymać workera w czystości.
:::

Wewnątrz handlera masz zwykły zestaw narzędzi — `header()`, `http_response_code()`, `echo` oraz `rapira_finish_request()`, które odsyła odpowiedź od razu i pozwala pracować dalej. Wszystko to opisuje [HTTP](/pl/docs/http).

## Przeniesienie ustawień do pliku konfiguracyjnego

Flagi wystarczą na czas eksperymentów, ale wdrożona aplikacja zwykle trzyma ustawienia w pliku. Na początek wystarczy `rapira.toml` obok kodu:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
Względną ścieżkę w `pool.entrypoint` Rapira liczy od katalogu samego pliku konfiguracyjnego, więc ten sam plik zadziała niezależnie od tego, w jakim katalogu akurat jesteś. Flagi wciąż mają pierwszeństwo przed plikiem — `rapira serve --config rapira.toml --processes 1` zachowa całą resztę i uruchomi tylko jeden worker.
:::

Te pięć linijek to ułamek tego, co plik przyjmuje: tryby skalowania puli, recykling workerów, limity czasu żądań, logowanie, pidfile supervisora. Nieznane klucze są odrzucane, a nie ignorowane, więc literówka przerwie start serwera, zamiast po cichu nic nie zmienić. Pełny opis znajdziesz w [Konfiguracji](/pl/docs/configuration), a flagi w [Wierszu poleceń](/pl/docs/cli).

## Zatrzymywanie serwera

Naciśnij `Ctrl-C`, a Rapira zacznie się wygaszać: przestanie przyjmować nową pracę, pozwoli dokończyć żądania będące już w toku, zamknie rozszerzenia i zakończy działanie. Drugie `Ctrl-C` pomija czekanie i wymusza wyjście — przydaje się, gdy jakieś żądanie się zacięło i nie chcesz czekać na jego koniec. `SIGTERM` działa tak samo i to dzięki temu restart z poziomu menedżera usług przebiega łagodnie. Pełną tabelę sygnałów — razem z przeładowaniem bez zrywania połączeń — znajdziesz w [Modelu procesów](/pl/docs/process-model).

## Co dalej

- [Tryb workera](/pl/docs/worker) — pętla workera od podszewki: stan, wycieki, recykling i sposób na wystartowanie prawdziwej aplikacji przed pętlą.
- [Konfiguracja](/pl/docs/configuration) — wszystkie klucze, które przyjmuje `rapira.toml`, wraz z wartościami domyślnymi.
- [Frameworki](/pl/docs/frameworks/) — gotowe skrypty wejściowe dla Symfony, Laravela i Yii3.

::: question Czy do uruchomienia skryptu workera potrzebuję Composera?
Nie. `create_plugin_handler()`, `HttpHandlerConfig` i klasy handlerów pochodzą z modułu PHP, który Rapira rejestruje przy starcie interpretera, więc powyższy skrypt działa zupełnie bez autoloadera. Prawdziwa aplikacja oczywiście dołączy przez `require` własny `vendor/autoload.php` — przed pętlą, żeby zapłacić za to tylko raz.
:::

::: question Czy jeden skrypt obsłuży i tryb klasyczny, i tryb workera?
Nie, a błąd jest jednoznaczny: poza trybem workera `create_plugin_handler()` rzuca wyjątek `Rapira\RapiraException`, bo w trybie klasycznym nie ma pętli, którą mógłby ci oddać. Zostaw zwykły front controller dla trybu klasycznego, a dla szczebla workera osobny `worker.php`; podłączenie każdego frameworka opisują [przewodniki po frameworkach](/pl/docs/frameworks/).
:::
