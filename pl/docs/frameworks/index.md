---
title: Integracja z frameworkami
description: "Pętle workera we frameworkach, stan żądania, stan trwały, obsługa błędów, pliki statyczne i OPcache."
---

# Integracja z frameworkami

W trybie Classic aplikacja frameworkowa działa bez zmian. Skonfiguruj Rapirę do używania istniejącego skryptu wejściowego. W trybie Worker proces PHP pozostaje aktywny między żądaniami. Budowa frameworka określa, który stan aplikacji może pozostać w pamięci. Ta strona opisuje zasady dla wszystkich frameworków. Przewodniki po frameworkach opisują tylko zachowanie konkretnego frameworka.

::: info Sprawdzone na

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** i **8.1.2**, **Yii3** szablon aplikacji 1.4 (yii-runner-http 3.2.1)

Testy uruchamiały te aplikacje na Linuksie z jednym procesem workera. Stwierdzenia o frameworkach na tej stronie pochodzą z tych testów. Przykłady na tej stronie używają formatu konfiguracji v0.9. Ustawienia Rapiry opisuje [Konfiguracja](/pl/docs/configuration).
:::

## Tryby Classic i Worker

**Tryb Classic używa istniejącego skryptu wejściowego.** Uruchamia nowe żądanie PHP dla każdego żądania HTTP. Framework działający pod php-fpm działa również w tym trybie. Więcej informacji zawiera strona [tryb Classic](/pl/docs/classic). Tylko poniższe sekcje o plikach statycznych, TLS i OPcache dotyczą trybu Classic.

**Tryb Worker utrzymuje aktywny proces.** Skrypt inicjalizuje aplikację i pobiera pracę w pętli. Stan aplikacji pozostaje między żądaniami. Więcej informacji zawierają strony [tryby wykonania](/pl/docs/execution-modes) i [tryb Worker](/pl/docs/worker).

Jedna baza kodu może używać obu trybów. Zachowaj `public/index.php`. Dodaj `worker.php` do katalogu głównego projektu. Klucz `http.pool.mode` wybiera tryb wykonania, a `http.pool.entrypoint` wybiera skrypt. Tryb Classic pozostaje dostępny, jeśli migracja do trybu Worker się nie powiedzie.

Każdy worker używa katalogu swojego skryptu wejściowego jako katalogu roboczego. Dlatego ścieżki względne w `worker.php` wskazują pliki względem katalogu głównego projektu. Ścieżki względne w `public/index.php` wskazują pliki względem `public/`. Wywołanie `chdir()` w kodzie PHP działa do zakończenia procesu workera.

## Pętla Worker

Każdy framework używa tej samej podstawowej struktury skryptu workera:

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // Worker tworzy ten obiekt raz i używa go ponownie.

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

- **`require .../vendor/autoload.php`** rejestruje autoloader. Autoloader i wczytane klasy pozostają dostępne do ponownego uruchomienia skryptu workera.
- **`$app = new App();`** inicjalizuje aplikację przed pętlą. Symfony przechowuje tutaj trwały kernel. Yii3 może przechowywać trwały runner albo tworzyć runner w handlerze. Każdy przewodnik pokazuje inicjalizację i czyszczenie po żądaniu.
- **`$handler = static function () use ($app): void`** definiuje handler bez argumentów. Handler czyta dane żądania ze zmiennych superglobalnych. Inne zależności otrzymuje przez `use`.
- **`header()`, `http_response_code()` i `echo`** tworzą odpowiedź jak w klasycznym skrypcie. Wysyłanie odpowiedzi opisuje strona [HTTP](/pl/docs/http).
- **`while (\Rapira\handle_request($handler))`** czeka na żądanie. `handle_request()` wypełnia zmienne superglobalne, uruchamia handler i kończy żądanie. Zwraca `true` po żądaniu i `false`, gdy worker się zatrzymuje. Wywołuj ją tylko z pętli najwyższego poziomu skryptu. Poza trybem Worker rzuca `Rapira\Exception\NotInWorkerModeError`.
- **`gc_collect_cycles();`** zbiera cykle referencji między żądaniami. Nie naprawia wycieków pamięci. Więcej informacji zawiera sekcja [Pamięć i recykling](#pamiec-i-recykling).

Wewnątrz handlera Rapira ustawia `SCRIPT_NAME` na `/worker.php`, ponieważ `worker.php` jest skryptem wejściowym. `DOCUMENT_ROOT` zawiera katalog skryptu. `REQUEST_URI` zawiera ścieżkę klienta. Symfony i Yii3 poprawnie kierowały żądania oraz tworzyły adresy URL z tymi wartościami. Utworzone adresy URL nie zawierały `worker.php`. Przed integracją innego frameworka sprawdź, czy tworzy adresy URL z `SCRIPT_NAME` zamiast z `REQUEST_URI`.

Przed pierwszym żądaniem `$_SERVER` zawiera środowisko procesu. W tym czasie `SCRIPT_NAME` zawiera bezwzględną ścieżkę skryptu, a `DOCUMENT_ROOT` jest pusty. `$_SERVER` żądania nie zawiera środowiska procesu. Odczytaj zmienne środowiskowe przed pętlą albo użyj `getenv()` w handlerze. Nie obliczaj prefiksu adresu URL z `$_SERVER` przed pętlą. Więcej informacji zawiera sekcja [`$_SERVER` przed pierwszym żądaniem](/pl/docs/execution-modes#server-przed-pierwszym-zadaniem).

## Stan pojedynczego żądania i stan rezydentny

Rapira odtwarza wszystko w lewej kolumnie przy każdym żądaniu. Zwykły kod PHP może odczytywać te wartości. Wszystko w prawej kolumnie pozostaje między żądaniami. Skrypt workera musi zarządzać tym stanem.

| Nowe dla każdego żądania | Pozostaje między żądaniami |
| ------------------------ | -------------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`: Rapira wypełnia je danymi żądania. `$_SERVER` nie zawiera środowiska procesu | Autoloader Composera i każda wczytana przez niego klasa |
| `php://input`: nieprzetworzona treść żądania, `CONTENT_TYPE` i `CONTENT_LENGTH` | Właściwości i zmienne `static`, które zachowują wartości między żądaniami |
| `$_FILES` i przesłane pliki tymczasowe | Obiekty utworzone przed pętlą, na przykład kontener, kernel i aplikacja |
| Dane sesji: `session_start()`, cookie żądania i pole odpowiedzi `Set-Cookie` | Otwarte zasoby: połączenia z bazą danych, klienty pamięci podręcznej, strumienie |
| Stan odpowiedzi: kod statusu, nagłówki, `setcookie()` i bufory wyjścia | Proces: ten sam pid i jeden rezydentny interpreter PHP dla każdego workera |
| Funkcje shutdown zarejestrowane **wewnątrz** handlera | Wartości `$_ENV` wczytane przed pętlą |
| Zegar `max_execution_time`, uruchamiany ponownie dla każdego żądania | |

Rapira uruchamia nowy zegar `max_execution_time` dla każdego żądania. Czas, w którym worker czeka na żądanie, nie wlicza się do tego limitu.

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

Rapira nie odtwarza `$_ENV` przy każdym żądaniu. Wartości, które kod zapisuje w `$_ENV` przed pętlą, pozostają do ponownego uruchomienia skryptu workera. Wczytaj konfigurację środowiska przed pętlą. Nie zapisuj danych żądania w `$_ENV`.

Zmiana `$_ENV` nie zmienia środowiska procesu. Użyj `putenv()`, gdy `getenv()` lub procesy potomne muszą widzieć wartość. W środowisku produkcyjnym ustaw zmienne w jednostce usługi, kontenerze lub orkiestratorze.
:::

## Obsługa błędów

Testy potwierdziły trzy rodzaje błędów z jednym workerem:

- **`exit` albo `die` w handlerze** wysyła bieżący status i wyjście. Proces się nie zatrzymuje, a worker nadal przyjmuje żądania. Na przykład framework może użyć `exit`, aby zwrócić odpowiedź informującą o przerwie technicznej.
- **Nieprzechwycony wyjątek** zwraca `500`, jeśli PHP nie wysłał wyjścia przed wyjątkiem. Po wysłaniu wyjścia pozostaje status, który PHP już wysłał. Handler wyjątków frameworka może zwrócić własną stronę błędu. Bez takiego handlera i z wyłączonym `display_errors` treść jest pusta. Worker nadal przyjmuje żądania.
- **Nieprzechwycony `Error`** daje ten sam wynik. Dla obu rodzajów PHP zapisuje rekord logu `Uncaught`.

Licznik `errors` workera zwiększa się, gdy żaden handler wyjątków nie przechwyci wyjątku lub `Error`. Żądanie z `exit` zwiększa tylko `handled`. We wszystkich trzech przypadkach `recycles` pozostaje zerowy.

Błąd krytyczny klasy bailout kończy skrypt rezydentny. Worker ponownie uruchamia skrypt i inicjalizuje aplikację. To ponowne uruchomienie zwiększa `recycles`. Zapis stanu opisany na stronie [model procesów](/pl/docs/process-model) pokazuje te liczniki.

## Pliki statyczne

Rapira obsługuje zasoby statyczne za pomocą [middleware plików statycznych](/pl/docs/static-files). Ustaw `[http.static].root` na katalog `public/` frameworka. Dodaj middleware do sekcji `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

Middleware zwraca odpowiedź tylko wtedy, gdy ścieżka odpowiada plikowi w katalogu głównym. Domyślna lista `forbid` blokuje pliki `.php`, więc middleware nie obsługuje skryptu wejściowego jako pliku. Inne adresy URL uruchamiają skrypt wejściowy. Adresy URL katalogów też uruchamiają skrypt wejściowy, ponieważ middleware nie obsługuje plików indeksu. `$_SERVER['REQUEST_URI']` zawiera ścieżkę klienta.

Zasoby statyczne może też obsługiwać CDN lub reverse proxy. Konfigurację reverse proxy opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

## TLS i proxy

Rapira przyjmuje tylko nieszyfrowany HTTP i nie ma ustawień TLS. Zakończ TLS na proxy. Połącz proxy przez interfejs pętli zwrotnej lub gniazdo uniksowe. `$_SERVER['HTTPS']` jest zawsze pusty, a `$_SERVER['REQUEST_SCHEME']` ma zawsze wartość `http`. Skonfiguruj zaufane proxy we frameworku, aby framework czytał `X-Forwarded-Proto`. Bez tej konfiguracji framework tworzy adresy URL `http://`.

Używaj łączników, a nie podkreśleń, w nazwach przekazywanych pól, ponieważ oba znaki mogą odpowiadać temu samemu kluczowi `$_SERVER`. Więcej informacji zawierają strony [HTTP](/pl/docs/http) i [wdrożenie produkcyjne](/pl/docs/deployment).

## Pamięć i recykling

Worker może tworzyć aplikację wewnątrz handlera. Wtedy aplikacja pozostaje w pamięci przez jedno żądanie. Worker zachowuje mniej stanu niż z trwałym kernelem Symfony, ale więcej niż w trybie Classic. Przenieś inicjalizację poza handler dopiero po zidentyfikowaniu trwałego stanu.

W tym wariancie każde żądanie tworzy graf obiektów. Cykle referencji mogą zachować stare grafy do uruchomienia kolektora cykli. Zużycie pamięci rośnie przez kilka żądań i spada, gdy PHP zwalnia wiele grafów. Ten wzorzec nie zawsze jest wyciekiem pamięci. Maksymalne zużycie pamięci może być jednak znacznie większe niż pamięć dla jednego żądania.

Testy wykazały, że `gc_collect_cycles()` w pętli ani w handlerze nie zapobiega temu wzorcowi. Późniejsza inicjalizacja może zachować referencje do starych grafów. Kolektor nie zwolni grafu, gdy odwołuje się do niego inny obiekt. Ustaw `memory_limit` powyżej zmierzonego maksimum. Ustaw też limit wymiany workera:

```toml
[http.pool]
max_requests = 100
```

Każdy worker zatrzymuje się po obsłużeniu więcej niż `max_requests` żądań, a proces nadrzędny uruchamia nowego workera. Każdy worker używa własnego limitu, od `max_requests + 1` do `max_requests` plus połowa tej wartości. Dlatego workery nie zatrzymują się jednocześnie. Testy wysłały setki żądań podczas kilku wymian. Pamięć wracała do poziomu początkowego, a każde żądanie zwracało `200`. To ustawienie ogranicza maksymalne zużycie pamięci w tym wzorcu.

Trwałe aplikacje Symfony i Yii3 miały stabilne użycie pamięci podczas tych samych testów. Pozostaw wymianę workerów włączoną, aby ograniczyć nieoczekiwany wzrost pamięci. Więcej informacji zawierają strony [Konfiguracja](/pl/docs/configuration) i [model procesów](/pl/docs/process-model).

## OPcache i zmieniony kod

Rapira uruchamia PHP raz w procesie nadrzędnym przed utworzeniem workerów. OPcache tworzy jeden segment pamięci współdzielonej, a każdy worker dziedziczy to samo mapowanie. Skompilowane skrypty pozostają w pamięci podręcznej między żądaniami i workerami we wszystkich trybach.

W PHP 8.4 OPcache jest osobnym plikiem `opcache.so`, który wymaga wiersza `zend_extension` w `php.ini`. Więcej informacji zawiera sekcja [php.ini](/pl/docs/intro/installation#php-ini).

W środowisku produkcyjnym `opcache.validate_timestamps = 0` wyłącza sprawdzanie plików dla każdego żądania. To ustawienie wyłącza automatyczne unieważnianie pamięci podręcznej. Segment OPcache należy do procesu nadrzędnego i pozostaje podczas wymiany workerów. Dlatego wdrożenie wymaga pełnego ponownego uruchomienia. Sekwencję opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

Podczas programowania trwała aplikacja nie czyta ponownie kodu inicjalizacji. To zachowanie nie zależy od OPcache. Po zmianie skryptu workera lub zainicjalizowanych usług naciśnij Ctrl-C. Następnie ponownie uruchom `rapira serve rapira.toml`.

## Przewodniki po frameworkach

- **[Symfony](/pl/docs/frameworks/symfony):** kernel inicjalizuje się raz i pozostaje w pamięci. `services_resetter` zeruje usługi stanowe między żądaniami. Jeden plik workera obsługuje Symfony 7.4 i 8.1.
- **[Laravel](/pl/docs/frameworks/laravel):** tryb Classic uruchamia standardowy plik `public/index.php` bez zmian. Tryb Worker jest opracowywany: Rapira nie udostępnia jeszcze wymaganego sterownika Octane.
- **[Yii3](/pl/docs/frameworks/yii3):** `StateResetter` zeruje trwały kontener po każdym żądaniu. Worker może też tworzyć nowy runner dla każdego żądania.

Inne frameworki mogą używać tego samego podstawowego skryptu workera. Użyj trybu Worker tylko wtedy, gdy aplikacja może obsłużyć wiele żądań w jednym procesie. Najpierw utwórz aplikację wewnątrz handlera. Ten wariant nie wymaga obsługi trwałych procesów przez framework.

Sprawdź aplikację w tym wariancie. Następnie zachowaj aplikację w pamięci. Zeruj stan żądania po każdym żądaniu. Użyj [trybu Classic](/pl/docs/classic), jeśli żaden wariant Worker nie działa prawidłowo.
