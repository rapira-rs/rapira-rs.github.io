---
title: Integracja z frameworkami
description: "Mechanika wspólna dla każdego frameworka działającego na Rapirze: pętla workera, stan pojedynczego żądania i stan rezydentny, obsługa błędów, pliki statyczne i OPcache."
---

# Integracja z frameworkami

W trybie Classic aplikacja frameworkowa działa bez zmian. Skonfiguruj Rapirę do używania istniejącego skryptu wejściowego. W trybie Worker proces PHP pozostaje aktywny między żądaniami. Budowa frameworka określa, który stan aplikacji może pozostać w pamięci. Ta strona opisuje wspólne zachowanie. Przewodniki po frameworkach opisują tylko zachowanie konkretnego frameworka.

::: info Sprawdzone na

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** i **8.1.2**, **Yii3** szablon aplikacji 1.4 (yii-runner-http 3.2.1)

Testy uruchamiały te aplikacje na Linuksie z jednym procesem workera. Stwierdzenia o frameworkach na tej stronie pochodzą z tych testów. Ustawienia Rapiry opisuje [Konfiguracja](/pl/docs/configuration).
:::

## Tryby Classic i Worker

**Tryb Classic używa istniejącego skryptu wejściowego.** Uruchamia nowe żądanie PHP dla każdego żądania HTTP. Framework działający pod php-fpm działa również w tym trybie. Więcej informacji zawiera strona [tryb Classic](/pl/docs/classic). Tylko poniższe sekcje o plikach statycznych, TLS i OPcache dotyczą trybu Classic.

**Tryb Worker utrzymuje aktywny proces.** Skrypt inicjalizuje aplikację i pobiera pracę w pętli. Stan aplikacji pozostaje między żądaniami. Więcej informacji zawierają strony [tryby wykonania](/pl/docs/execution-modes) i [tryb Worker](/pl/docs/worker).

Jedna baza kodu może używać obu trybów. Zachowaj `public/index.php`. Dodaj `worker.php` do katalogu głównego projektu. Użyj `--mode`, aby wybrać tryb wykonania. Wybierz skrypt argumentem `SCRIPT` albo ustawieniem `pool.entrypoint`. Użyj trybu Classic, jeśli migracja do trybu Worker nie działa.

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

- **`require .../vendor/autoload.php`** rejestruje autoloader do ponownego uruchomienia skryptu workera. Wczytane klasy pozostają dostępne.
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

Rapira ustawia `SCRIPT_NAME` na `/worker.php`, ponieważ jest to skrypt wejściowy. `DOCUMENT_ROOT` zawiera katalog skryptu. `REQUEST_URI` zawiera ścieżkę klienta. Symfony i Yii3 poprawnie kierowały żądania oraz tworzyły adresy URL z tymi wartościami. Adresy nie zawierały `worker.php`. Przed integracją innego frameworka sprawdź, czy tworzy adresy z `SCRIPT_NAME` zamiast `REQUEST_URI`.

## Stan pojedynczego żądania i stan rezydentny

Rapira odtwarza wszystko w lewej kolumnie przy każdym żądaniu. Zwykły kod PHP może odczytywać te wartości. Wszystko w prawej kolumnie pozostaje między żądaniami. Skrypt workera musi zarządzać tym stanem.

| Nowe dla każdego żądania | Pozostaje między żądaniami |
| ------------------------ | -------------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`: Rapira wypełnia je danymi żądania | Autoloader Composera i każda wczytana przez niego klasa |
| `php://input`: nieprzetworzona treść żądania, `CONTENT_TYPE` i `CONTENT_LENGTH` | Właściwości i zmienne `static`, które zachowują wartości między żądaniami |
| `$_FILES` i przesłane pliki tymczasowe | Obiekty utworzone przed pętlą, na przykład kontener, kernel i aplikacja |
| Dane sesji: `session_start()`, cookie żądania i pole odpowiedzi `Set-Cookie` | Otwarte zasoby: połączenia z bazą danych, klienty pamięci podręcznej, strumienie |
| Stan odpowiedzi: kod statusu, nagłówki, `setcookie()` i bufory wyjścia | Proces: ten sam pid i jeden rezydentny interpreter PHP dla każdego workera |
| Funkcje shutdown zarejestrowane **wewnątrz** handlera | Liczniki workera: `handled` i `errors` nadal się zwiększają |
| Zegar `max_execution_time`, uruchamiany ponownie dla każdego żądania | `$_ENV`, w tym wartości wczytane przed pętlą |

Na Linuksie i FreeBSD Zend uruchamia nowy zegar `max_execution_time` dla każdego żądania. Czas oczekiwania workera nie wlicza się do tego limitu. W innych systemach, w tym macOS, PHP nie uruchamia zegara żądania.

Trzy opisane niżej zachowania dotyczą rezydentnego workera.

::: warning Rezydentny obiekt zachowuje stan między żądaniami

PHP nie wywołuje destruktora rezydentnego obiektu na końcu żądania. Wywołuje go raz, gdy kończy się cykl workera albo gdy kod usuwa ostatnią referencję do obiektu.

Nie używaj destruktora do sprzątania po pojedynczym żądaniu. Stan żądania resetuj wewnątrz handlera.
:::

::: warning Funkcja shutdown z inicjalizacji wykonuje się raz na końcu cyklu workera

PHP wykonuje funkcję shutdown zarejestrowaną poza handlerem jeden raz na końcu cyklu workera. Funkcja zarejestrowana wewnątrz handlera wykonuje się na końcu tego żądania.

Funkcje shutdown dla żądania rejestruj wewnątrz handlera. Dotyczy to na przykład zapisu metryk, obsługi błędu krytycznego i zwolnienia zasobów żądania.
:::

::: warning `$_ENV` pozostaje między żądaniami

Rapira nie odtwarza `$_ENV` przy każdym żądaniu. Wartości zapisane przed pętlą pozostają dostępne do ponownego uruchomienia skryptu workera. Traktuj `$_ENV` jako rezydentny stan aplikacji. Wczytaj konfigurację środowiska przed pętlą. Nie zapisuj danych żądania w `$_ENV`.

Rapira zachowuje wartości w `$_ENV` bez `putenv()`. Użyj `putenv()`, gdy kod potrzebuje zachowania środowiska procesu, na przykład `getenv()` lub dziedziczenia przez proces potomny. W środowisku produkcyjnym ustaw zmienne w jednostce usługi, kontenerze lub orkiestratorze.
:::

## Obsługa błędów

Testy potwierdziły trzy rodzaje błędów z jednym workerem:

- **`exit` albo `die` w handlerze** wysyła bieżący status i wyjście. Worker nadal przyjmuje żądania.
- Framework może użyć `exit` do odpowiedzi konserwacyjnej bez kończenia procesu.
- **Nieprzechwycony wyjątek** zwraca `500`. Handler frameworka może zwrócić własną stronę błędu.
- Bez takiego handlera Rapira zwraca pustą treść. Worker nadal przyjmuje żądania.
- **Nieprzechwycony `Error`** również zwraca `500`, a worker działa dalej. PHP zapisuje `Uncaught Error`.

Licznik `errors` zwiększa się w dwóch przypadkach błędu. Żądanie z `exit` zwraca `200` i zmienia tylko `handled`. We wszystkich trzech przypadkach `recycles` i `restarts` pozostają zerowe. Nieprzechwycony throwable nie zatrzymuje workera ani następnego żądania. Błąd krytyczny klasy bailout kończy skrypt rezydentny. Worker ponownie uruchamia skrypt i inicjalizuje aplikację. Ta czynność zwiększa `recycles`. Te liczniki opisuje strona [model procesów](/pl/docs/process-model).

## Pliki statyczne

Rapira obsługuje zasoby statyczne za pomocą [middleware plików statycznych](/pl/docs/static-files). Ustaw `[http.static].root` na katalog `public/` frameworka. Dodaj middleware do sekcji `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

Middleware zwraca odpowiedź tylko wtedy, gdy ścieżka odpowiada plikowi w katalogu głównym. Domyślna lista `forbid` blokuje dostęp do plików `.php`. Dlatego middleware nie obsługuje skryptu wejściowego jako pliku. Inne adresy URL uruchamiają skrypt wejściowy w trybach Classic i Worker. `$_SERVER['REQUEST_URI']` zawiera ścieżkę klienta. Adresy URL katalogów też uruchamiają skrypt wejściowy, ponieważ middleware nie obsługuje plików indeksu.

Zasoby statyczne może też obsługiwać CDN lub reverse proxy. Konfigurację reverse proxy opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

## TLS i proxy

Rapira przyjmuje nieszyfrowany HTTP i nie udostępnia ustawień TLS. Zakończ TLS na proxy. Połącz proxy przez interfejs pętli zwrotnej lub gniazdo uniksowe. Używaj łączników zamiast podkreśleń w nazwach przekazywanych pól. Oba znaki mogą odpowiadać temu samemu kluczowi `$_SERVER`. Więcej informacji zawierają strony [HTTP](/pl/docs/http) i [wdrożenie produkcyjne](/pl/docs/deployment).

## Pamięć i recykling

Worker może tworzyć aplikację wewnątrz handlera. Ten wariant zachowuje aplikację przez jedno żądanie. Zachowuje mniej stanu niż trwały kernel Symfony, ale więcej niż tryb Classic. Pętla pozostaje w skrypcie workera. Przenieś inicjalizację poza handler dopiero po sprawdzeniu trwałego stanu. Ten wariant tworzy kontener po nadejściu żądania.

Każde żądanie w tym wariancie tworzy graf obiektów. Cykle referencji mogą zachować stare grafy do uruchomienia kolektora. Zużycie pamięci rośnie przez kilka żądań i spada po zwolnieniu kilku grafów. Takie cykliczne użycie nie zawsze jest wyciekiem. Maksymalne zużycie pamięci może być jednak znacznie większe niż dla jednego żądania.

Testy wykazały, że `gc_collect_cycles()` nie zapobiega temu zachowaniu w pętli ani w handlerze. Późniejsza inicjalizacja może zachować referencje do starych grafów. Kolektor nie zwolni grafu, gdy odwołuje się do niego inny obiekt. Ustaw `memory_limit` powyżej zmierzonego maksimum. Ustaw też limit wymiany workera:

```toml
[pool]
max_requests = 100
```

Proces nadrzędny zastępuje workera po osiągnięciu limitu żądań. Rapira nieznacznie zmienia limit, aby zapobiec jednoczesnej wymianie. Testy wysłały setki żądań podczas kilku wymian. Pamięć wracała do poziomu początkowego, a każde żądanie zwracało `200`. To ustawienie zapewnia przewidywalny limit użycia pamięci.

Trwałe aplikacje Symfony i Yii3 miały stabilne użycie pamięci podczas tych samych testów. Pozostaw wymianę workerów włączoną, aby ograniczyć nieoczekiwany wzrost pamięci. Więcej informacji zawierają strony [Konfiguracja](/pl/docs/configuration) i [model procesów](/pl/docs/process-model).

## OPcache i zmieniony kod

Rapira uruchamia PHP raz w procesie nadrzędnym przed utworzeniem workerów. OPcache tworzy jeden segment pamięci współdzielonej. Każdy worker dziedziczy to samo mapowanie. Skompilowane skrypty pozostają w pamięci podręcznej między żądaniami i workerami w obu trybach.

W środowisku produkcyjnym `opcache.validate_timestamps = 0` wyłącza sprawdzanie plików dla każdego żądania. To ustawienie wyłącza automatyczne unieważnianie pamięci podręcznej. Segment OPcache należy do procesu nadrzędnego i pozostaje podczas wymiany workerów. Dlatego wdrożenie wymaga pełnego ponownego uruchomienia. Sekwencję opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

Podczas programowania trwała aplikacja nie czyta ponownie kodu inicjalizacji. To zachowanie nie zależy od OPcache. Uruchom serwer ponownie po zmianie skryptu workera lub zainicjalizowanych usług. Naciśnij Ctrl-C i ponownie uruchom `rapira serve`.

## Przewodniki po frameworkach

- **[Symfony](/pl/docs/frameworks/symfony):** kernel inicjalizuje się raz i pozostaje w pamięci. `services_resetter` zeruje usługi stanowe między żądaniami.
- Jeden plik workera obsługuje Symfony 7.4 i 8.1.
- **[Laravel](/pl/docs/frameworks/laravel):** tryb Classic uruchamia standardowy plik `public/index.php` bez zmian.
- Tryb Worker dla Laravela jest opracowywany. Rapira nie udostępnia jeszcze wymaganego sterownika Octane.
- **[Yii3](/pl/docs/frameworks/yii3):** `StateResetter` zeruje trwały kontener po każdym żądaniu.
- Worker może też tworzyć nowy runner dla każdego żądania.

Inne frameworki mogą używać tego samego podstawowego skryptu. Użyj trybu Worker tylko wtedy, gdy aplikacja obsługuje wiele żądań w jednym procesie. Najpierw utwórz aplikację wewnątrz handlera. Ten wariant nie wymaga obsługi trwałych procesów przez framework. Sprawdź aplikację w tym wariancie. Następnie zachowaj aplikację między żądaniami. Zeruj stan żądania po każdym żądaniu. Użyj [trybu Classic](/pl/docs/classic), jeśli żaden wariant Worker nie działa prawidłowo.
