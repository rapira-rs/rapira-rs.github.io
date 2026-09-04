---
title: Integracja z frameworkami
description: "Mechanika wspólna dla każdego frameworka działającego na Rapirze: pętla workera, stan pojedynczego żądania i stan rezydentny, obsługa błędów, pliki statyczne i OPcache."
---

# Integracja z frameworkami

W trybie Classic aplikacja frameworkowa działa bez zmian. Skonfiguruj Rapirę do używania istniejącego skryptu wejściowego.
W trybie Worker proces PHP pozostaje aktywny między żądaniami. Budowa frameworka określa, który stan aplikacji może pozostać w pamięci.
Ta strona opisuje wspólne zachowanie. Przewodniki po frameworkach opisują tylko zachowanie konkretnego frameworka.

::: info Sprawdzone na

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** i **8.1.2**, **Yii3** szablon aplikacji 1.4 (yii-runner-http 3.2.1)

Wszystko, co znajdziesz na tej stronie, zostało zaobserwowane na tych aplikacjach uruchomionych na Linuksie, na jednym procesie workera. Stwierdzenia o zachowaniu frameworków opierają się na tych przebiegach. Klucze konfiguracyjne pochodzą z własnego opisu [konfiguracji](/pl/docs/configuration) Rapiry.
:::

## Tryby Classic i Worker

**Tryb Classic używa istniejącego skryptu wejściowego.** Uruchamia nowe żądanie PHP dla każdego żądania HTTP.
Framework działający pod php-fpm działa również w tym trybie. Więcej informacji zawiera strona [tryb Classic](/pl/docs/classic).
Sekcje o plikach statycznych, TLS i OPcache również dotyczą trybu Classic.

**Tryb Worker utrzymuje aktywny proces.** Skrypt inicjalizuje aplikację i pobiera pracę w pętli.
Stan aplikacji pozostaje między żądaniami. Więcej informacji zawierają strony [tryby wykonania](/pl/docs/execution-modes) i [tryb Worker](/pl/docs/worker).

Jedna baza kodu może używać obu trybów. Zachowaj `public/index.php`. Dodaj obok niego `worker.php`.
Użyj `--mode`, aby wybrać tryb wykonania. Wybierz skrypt argumentem `SCRIPT` albo ustawieniem `pool.entrypoint`.
Użyj trybu Classic, jeśli migracja do trybu Worker nie działa.

## Pętla Worker

Każdy framework używa tej samej podstawowej struktury skryptu workera:

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Skrypt wykonuje te operacje:

- **`require .../vendor/autoload.php`** rejestruje autoloader na czas działania workera. Wczytane klasy pozostają dostępne.
- **`$app = new App();`** inicjalizuje aplikację przed pętlą. Symfony przechowuje tutaj trwały kernel.
- Yii3 może przechowywać trwały runner albo tworzyć go w handlerze. Każdy przewodnik pokazuje wymaganą inicjalizację i czyszczenie.
- **`$handler = static function () use ($app): void`** definiuje handler bez argumentów. Handler czyta żądanie ze zmiennych superglobalnych.
- Przechwytuje inne zależności przez `use`.
- **`header()`, `http_response_code()` i `echo`** tworzą odpowiedź jak w klasycznym skrypcie. Więcej informacji zawiera strona [HTTP](/pl/docs/http).
- **`while (\Rapira\handle_request($handler))`** czeka na żądanie. `handle_request()` wypełnia zmienne superglobalne, uruchamia handler i kończy żądanie.
- Zwraca `true` po żądaniu i `false` podczas zatrzymywania. Wywołuj ją tylko z pętli najwyższego poziomu.
- Poza trybem Worker rzuca `Rapira\Exception\NotInWorkerModeError`.
- **`gc_collect_cycles();`** działa między żądaniami i zbiera cykle referencji. Nie naprawia wycieków pamięci.
- Więcej informacji zawiera sekcja [Pamięć i recykling](#pamiec-i-recykling).

Rapira ustawia `SCRIPT_NAME` na `/worker.php`, ponieważ jest to skrypt wejściowy.
`DOCUMENT_ROOT` zawiera katalog skryptu. `REQUEST_URI` zawiera ścieżkę klienta.
Symfony i Yii3 poprawnie kierowały żądania oraz tworzyły adresy URL z tymi wartościami. Adresy nie zawierały `worker.php`.
Przed integracją innego frameworka sprawdź, czy tworzy adresy z `SCRIPT_NAME` zamiast `REQUEST_URI`.

## Stan pojedynczego żądania i stan rezydentny

Wszystko z lewej kolumny Rapira odbudowuje przy każdym żądaniu, więc zwykły kod PHP, który stamtąd czyta, działa dalej. Wszystko z prawej kolumny trwa tak długo jak sam worker i musi tym zarządzać skrypt workera.

| Świeże przy każdym żądaniu | Przeżywa każde żądanie |
| -------------------------- | ---------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` - wypełnione na nowo danymi tego żądania | Autoloader Composera i każda klasa już przez niego wczytana |
| `php://input` - surowa treść tego żądania, a obok niej `CONTENT_TYPE` i `CONTENT_LENGTH` | Właściwości i zmienne `static`, które liczą dalej przez kolejne żądania |
| `$_FILES` i stojące za nim tymczasowe pliki wysłane przez klienta | Obiekty utworzone przed pętlą - kontener, kernel, twoja aplikacja |
| Obsługa sesji: `session_start()`, ciasteczko na wejściu, `Set-Cookie` na wyjściu | Otwarte zasoby: uchwyty do bazy, klienty cache'a, strumienie |
| Stan odpowiedzi: kod statusu, nagłówki, `setcookie()`, bufory wyjścia | Sam proces - ten sam pid, jeden rezydentny interpreter PHP na workera |
| Funkcje shutdown zarejestrowane **wewnątrz** handlera | Własne liczniki workera: `handled` i `errors` zwiększają się dalej |
| Zegar `max_execution_time`, uzbrajany na nowo przy każdym żądaniu | |

Na Linuksie (i na FreeBSD), gdzie zendowy licznik czasu żądania w ogóle istnieje, zegar `max_execution_time` jest uzbrajany na nowo przy każdym żądaniu, a czas, który worker spędza zaparkowany w oczekiwaniu na kolejne, nigdy się do niego nie wlicza - na zegarze tyka wyłącznie samo żądanie. Wszędzie indziej, macOS w to wliczając, żaden limit czasu żądania nie jest uzbrajany w ogóle.

Trzy opisane niżej zachowania dotyczą rezydentnego workera.

::: warning Rezydentny obiekt zachowuje stan między żądaniami

PHP nie wywołuje destruktora rezydentnego obiektu na końcu żądania. Wywołuje go raz, gdy kończy się cykl workera albo gdy kod usuwa ostatnią referencję do obiektu.

Nie używaj destruktora do sprzątania po pojedynczym żądaniu. Stan żądania resetuj wewnątrz handlera.
:::

::: warning Funkcja shutdown z rozruchu wykonuje się raz przy zamknięciu workera

PHP wykonuje funkcję shutdown zarejestrowaną poza handlerem jeden raz na końcu cyklu workera. Funkcja zarejestrowana wewnątrz handlera wykonuje się na końcu tego żądania.

Funkcje shutdown dla żądania rejestruj wewnątrz handlera. Dotyczy to na przykład zapisu metryk, obsługi błędu krytycznego i zwolnienia zasobów żądania.
:::

::: warning PHP może ponownie zaimportować `$_ENV` podczas żądania

Przy domyślnych ustawieniach ini PHP zeruje flagę JIT dla `$_ENV` przy każdym żądaniu.
Pierwszy nowo skompilowany plik używający `$_ENV` powoduje ponowne utworzenie tej zmiennej superglobalnej.
Bez `E` w `variables_order` PHP nie importuje wartości. Dlatego `$_ENV` staje się **puste** bez komunikatu diagnostycznego.
Usuwa to wartości zapisane przez Dotenv podczas inicjalizacji.

Wynik zależy od czasu kompilacji pliku. Konfiguracja przetworzona podczas inicjalizacji może użyć wartości przed wyczyszczeniem `$_ENV`.
Konfiguracja przetworzona podczas pierwszego żądania może odczytać puste `$_ENV`. Ta różnica może powodować błędy zależne od środowiska.

Dostępne są dwa rozwiązania. Zapisz wartości w środowisku procesu za pomocą `putenv()`.
Ponowny import zachowuje te wartości, a framework może je odczytać przez `getenv()`.
W środowisku produkcyjnym ustaw zmienne w jednostce usługi lub kontenerze. Nie przetwarzaj `.env` podczas żądań.
Przy `variables_order = "GPCS"` oba rozwiązania pozostawiają `$_ENV` puste. Przykład zawiera [przewodnik po Symfony](/pl/docs/frameworks/symfony).

Trafia na to każde środowisko uruchomieniowe PHP, które trzyma proces przy życiu między żądaniami.
:::

## Obsługa błędów

Testy potwierdziły trzy rodzaje błędów z jednym workerem:

- **`exit` albo `die` w handlerze** wysyła bieżący status i wyjście. Worker nadal przyjmuje żądania.
- Framework może użyć `exit` do odpowiedzi konserwacyjnej bez kończenia procesu.
- **Nieprzechwycony wyjątek** zwraca `500`. Handler frameworka może zwrócić własną stronę błędu.
- Bez takiego handlera Rapira zwraca pustą treść. Worker nadal przyjmuje żądania.
- **Nieprzechwycony `Error`** również zwraca `500`, a worker działa dalej. PHP zapisuje `Uncaught Error`.

Licznik `errors` zwiększa się w dwóch przypadkach błędu. Żądanie z `exit` zwraca `200` i zmienia tylko `handled`.
We wszystkich trzech przypadkach `recycles` i `restarts` pozostają zerowe. Nieprzechwycony throwable nie zatrzymuje workera ani następnego żądania.
Błąd krytyczny klasy bailout kończy skrypt rezydentny. Worker ponownie uruchamia skrypt i inicjalizuje aplikację.
Ta czynność zwiększa `recycles`. Te liczniki opisuje strona [model procesów](/pl/docs/process-model).

## Pliki statyczne

Zasoby statyczne Rapira serwuje przez [middleware plików statycznych](/pl/docs/static-files). Ustaw `root` w sekcji `[http.static]` na katalog `public/` frameworka i wypisz middleware w `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

Middleware odpowiada na żądanie tylko wtedy, gdy ścieżka trafia w plik leżący w tym katalogu. Domyślna lista `forbid` trzyma poza nim pliki `.php`, więc skrypt wejściowy z `public/` nigdy nie zostanie oddany jako plik. Każdy inny adres URL uruchamia skrypt wejściowy, tak samo w trybie Classic, jak i w trybie Worker. `$_SERVER['REQUEST_URI']` mówi aplikacji, dokąd chciał trafić klient. Adres wskazujący katalog też uruchamia skrypt wejściowy, bo middleware nie serwuje dla niego żadnego pliku indeksu.

Zasoby może zamiast tego serwować CDN albo reverse proxy stojące z przodu. Takie proxy stawia [wdrożenie produkcyjne](/pl/docs/deployment).

## TLS i proxy

Nasłuch Rapiry mówi nieszyfrowanym HTTP, a w konfiguracji nie ma żadnej sekcji od TLS-a. Zakończ TLS na proxy, które i tak już masz, i pozwól mu dobić do Rapiry po loopbacku albo po unixowym gnieździe. Proxy musi zapisywać przekazywane pola z `-`, nigdy z `_`, bo obie pisownie schodzą się pod tym samym kluczem `$_SERVER`. To mapowanie wyjaśnia [HTTP](/pl/docs/http), a konfigurację proxy - [wdrożenie produkcyjne](/pl/docs/deployment).

## Pamięć i recykling

Worker może tworzyć aplikację wewnątrz handlera. Ten wariant zachowuje aplikację przez jedno żądanie.
Zachowuje mniej stanu niż trwały kernel Symfony, ale więcej niż tryb Classic.
Pętla pozostaje w skrypcie workera. Przenieś inicjalizację poza handler dopiero po sprawdzeniu trwałego stanu.
Ten wariant tworzy kontener po nadejściu żądania.

Każde żądanie w tym wariancie tworzy graf obiektów. Cykle referencji mogą zachować stare grafy do uruchomienia kolektora.
Zużycie pamięci rośnie przez kilka żądań i spada po zwolnieniu kilku grafów. Takie cykliczne użycie nie zawsze jest wyciekiem.
Maksymalne zużycie pamięci może być jednak znacznie większe niż dla jednego żądania.

Testy wykazały, że `gc_collect_cycles()` nie zapobiega temu zachowaniu w pętli ani w handlerze.
Późniejsza inicjalizacja może zachować referencje do starych grafów. Kolektor nie zwolni grafu, gdy odwołuje się do niego inny obiekt.
Ustaw `memory_limit` powyżej zmierzonego maksimum. Ustaw też limit wymiany workera:

```toml
[pool]
max_requests = 100
```

Proces nadrzędny zastępuje workera po osiągnięciu limitu żądań. Rapira nieznacznie zmienia limit, aby zapobiec jednoczesnej wymianie.
Testy wysłały setki żądań podczas kilku wymian. Pamięć wracała do poziomu początkowego, a każde żądanie zwracało `200`.
To ustawienie zapewnia przewidywalny limit użycia pamięci.

Warianty rezydentne - kernel Symfony, kontener Yii3 za `StateResetter` - są przy tym płaskie: w tych samych przebiegach pamięć trzymała poziom. Recykling trzymaj włączony również dla nich, jako zabezpieczenie. Klucz opisuje [konfiguracja](/pl/docs/configuration), a to, co recykling robi z pulą - [model procesów](/pl/docs/process-model).

## OPcache i zmieniony kod

Rapira uruchamia PHP raz w procesie nadrzędnym przed utworzeniem workerów. OPcache tworzy jeden segment pamięci współdzielonej.
Każdy worker dziedziczy to samo mapowanie. Skompilowane skrypty pozostają w pamięci podręcznej między żądaniami i workerami w obu trybach.

Na produkcji `opcache.validate_timestamps = 0` usuwa `stat` każdego pliku z każdego żądania. Przy tym ustawieniu nic nie unieważnia cache'u. Segment należy do procesu nadrzędnego i przeżywa każde pokolenie workerów. Dlatego przeładowanie kroczące nadal serwuje stare opcode'y, a wdrożenie wymaga pełnego restartu. Kolejność kroków opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

Podczas programowania trwała aplikacja nie czyta ponownie kodu inicjalizacji. To zachowanie nie zależy od OPcache.
Uruchom serwer ponownie po zmianie skryptu workera lub zainicjalizowanych usług. Naciśnij Ctrl-C i ponownie uruchom `rapira serve`.

## Przewodniki po frameworkach

- **[Symfony](/pl/docs/frameworks/symfony)** - kernel podnosi się raz i zostaje rezydentny, a własny `services_resetter` frameworka przywraca między żądaniami usługi ze stanem do postaci, w jakiej je zastał. Jeden plik workera obsługuje 7.4 i 8.1, bajt w bajt.
- **[Laravel](/pl/docs/frameworks/laravel)** - tryb Classic: standardowy `public/index.php` działa bez zmian. Tryb Worker dla Laravela jest w opracowaniu - rezydentna aplikacja Laravela potrzebuje takiego przywracania stanu, jakie realizuje Octane, a Rapira nie ma jeszcze sterownika do Octane'a.
- **[Yii3](/pl/docs/frameworks/yii3)** - `StateResetter` zeruje trwały kontener po każdym żądaniu. Worker może też tworzyć nowy runner dla każdego żądania.

Inne frameworki mogą używać tego samego podstawowego skryptu. Użyj trybu Worker tylko wtedy, gdy aplikacja obsługuje wiele żądań w jednym procesie.
Najpierw utwórz aplikację wewnątrz handlera. Ten wariant nie wymaga obsługi trwałych procesów przez framework.
Po sprawdzeniu zachowaj aplikację i zeruj jej stan żądania. Użyj [trybu Classic](/pl/docs/classic), jeśli oba warianty Worker nie działają.
