---
title: Yii3
description: "Uruchamianie Yii3 w trybie Worker z rezydentnym HttpApplicationRunner i StateResetter albo z nowym runnerem dla każdego żądania."
---

# Yii3

Yii3 obsługuje trwałe procesy. Worker może raz zainicjalizować aplikację i zerować stan żądania po każdej odpowiedzi. Oficjalny runner [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) używa tego samego rozwiązania. Ta strona opisuje trwały worker, wariant na każde żądanie i wyniki testów integracyjnych.

::: info Sprawdzone na
- **PHP 8.5.8**: NTS, embed SAPI
- **Rapira 0.8.0**
- szablon **yiisoft/app** 1.4, z **yii-runner-http 3.2.1** (router-fastroute 4.x)

Testy uruchomiły oba skrypty workera na tym oprogramowaniu. Obejmowały routing, adresy URL, ciała żądań, sesje, przesyłanie plików, błędy i 200 kolejnych żądań. Przykłady na tej stronie używają formatu konfiguracji v0.9.
:::

## Yii3 a tryb Worker

Rezydentny worker używa dwóch elementów publicznego API:

- `ApplicationRunner::getContainer()` zwraca kontener aplikacji. Worker nie wymaga podklasy ani dostępu do prywatnego stanu.
- `Yiisoft\Di\StateResetter` jest serwisem tego kontenera. Komponenty rejestrują callbacki zerujące, a jedno wywołanie `reset()` uruchamia je wszystkie.

Serwis aplikacji ze stanem żądania również musi zarejestrować callback. Dodaj klucz `'reset' => function (): void { … }` do jego definicji DI. `yiisoft/session` i `yiisoft/router` używają tej samej metody. Domknięcie może wyzerować prywatny stan i nie tworzy nowego obiektu. Czas życia stanu opisują [przegląd frameworków](/pl/docs/frameworks/) i [tryb Worker](/pl/docs/worker).

Trwały wariant ma trzy kroki. Utwórz runner raz. Uruchamiaj go dla każdego żądania. Zeruj kontener po każdym żądaniu.

## Zanim zaczniesz

- Zainstaluj Rapirę. Zobacz [Instalację](/pl/docs/intro/installation).
- Utwórz lub wybierz aplikację Yii3. Możesz użyć nowego projektu [`yiisoft/app`](https://github.com/yiisoft/app).

Skrypt workera to jedyny nowy plik PHP. Umieść go w katalogu głównym projektu obok `composer.json`. Runner używa katalogu głównego projektu jako `rootPath`.

Zainstaluj PHP CLI dla Composera. Rapira dostarcza PHP jako bibliotekę, a nie jako polecenie `php`. Rapira nie używa ani nie zmienia systemowego PHP CLI.

## Rezydentny worker

To wariant zalecany. Zapisz go jako `worker.php` w katalogu głównym projektu:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // Worker działa dalej, gdy błąd przerwie run().
        // Wyzeruj stan przed następnym żądaniem.
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Skrypt wykonuje te operacje:

**`src/bootstrap.php` inicjalizuje szablon.** Ładuje autoloader Composera, czyta `.env`, jeśli plik istnieje, i wywołuje `Environment::prepare()`. Standardowy `public/index.php` wykonuje te same operacje, zanim użyje runnera.

**Worker tworzy runner raz.** Używa argumentów `rootPath`, `debug`, `checkEvents` i `environment` z `public/index.php`. Dlatego inicjalizuje tę samą aplikację.

**Handler wywołuje `run()`, a potem `reset()` dla każdego żądania.** `run()` obsługuje żądanie tak samo jak skrypt wejściowy. `reset()` uruchamia zarejestrowane callbacki zerujące przed następnym żądaniem.

**Zużycie pamięci pozostało stabilne.** Testy nie wykazały istotnego wzrostu pamięci procesu podczas 200 kolejnych żądań.

::: question Które części szablonu pomija worker?
Szablon przekazuje `temporaryErrorHandler` z loggerem `StreamTarget`. Wczytuje też `c3.php`, gdy włączysz `APP_C3`. Testowany worker pomija obie części. Bez tego handlera `HttpApplicationRunner::createTemporaryErrorHandler()` tworzy `ErrorHandler` z `NullLogger`. Dlatego runner nie zapisuje błędów podczas tworzenia konfiguracji i kontenera. Przekaż handler szablonu, aby zapisywać te błędy.
:::

::: question Czy trwały runner odczytuje bieżące żądanie?
Tak. `run()` nie przechowuje żądania z chwili tworzenia runnera. Każde wywołanie pobiera `RequestFactory` i tworzy `ServerRequest` w standardzie PSR-7 ze zmiennych superglobalnych i `php://input`. Rapira wypełnia te wartości przed każdym wywołaniem handlera. Każde wywołanie rejestruje też handler błędów, wywołuje `runBootstrap()` i wywołuje `checkEvents()`, gdy jego flaga ma wartość true. Testy potwierdziły tę sekwencję podczas 200 wywołań. Umowę dotyczącą danych żądania opisuje [tryb Worker](/pl/docs/worker).
:::

## Nowy runner dla każdego żądania

Utwórz runner *wewnątrz* handlera, aby uniknąć trwałego stanu kontenera. Obiekty aplikacji należą wtedy do jednego żądania:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // Utwórz jeden runner dla każdego żądania.
    // Użyj tych samych argumentów co public/index.php.
    $runner = new HttpApplicationRunner(
        rootPath: __DIR__,
        debug: Environment::appDebug(),
        checkEvents: Environment::appDebug(),
        environment: Environment::appEnv(),
    );
    $runner->run();
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Każde żądanie tworzy nowy kontener, więc worker nie zeruje stanu kontenera. Właściwości statyczne, zmienne globalne i stan inicjalizacji zostają w workerze. Kod aplikacji musi zerować ten stan. Testy potwierdziły też ten wariant.

Kontener jest inicjalizowany dla każdego żądania. Dodaje to czas inicjalizacji i tworzy obiekty, które PHP musi później zwolnić. Pamięć może rosnąć do czasu, gdy PHP zwolni kilka starych kontenerów naraz. To cykliczne zachowanie nie musi oznaczać wycieku pamięci. Zobacz [Pamięć i recykling](/pl/docs/frameworks/#pamiec-i-recykling).

Ustaw `http.pool.max_requests`, aby okresowo zastępować workery. Ten klucz opisuje [Konfiguracja](/pl/docs/configuration).

Ten wariant to nie [tryb Classic](/pl/docs/classic). Autoloader, bootstrap szablonu i pętla żądań zostają w workerze. Tylko aplikacja jest nowa dla każdego żądania.

Domyślnie używaj trwałego runnera. Jest zgodny z projektem frameworka, wymaga jednego wywołania zerowania i w testach miał stabilne zużycie pamięci. Użyj runnera na żądanie, jeśli kolejność inicjalizacji lub przygotowanie żądania uniemożliwiają pełny callback `StateResetter`. Aby przejść między wariantami, zmień tylko skrypt workera.

## Uruchamianie Rapiry

Utwórz `rapira.toml` obok `worker.php`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

`mode = "worker"` wybiera tryb Worker. Polecenie opisuje [Wiersz poleceń](/pl/docs/cli).

Na produkcji użyj pełnego pliku `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "/srv/app/worker.php"
mode = "worker"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

Każdy klucz, jego wartość domyślną i limit opisuje [Konfiguracja](/pl/docs/configuration). Konfigurację systemd i reverse proxy opisuje [Wdrożenie produkcyjne](/pl/docs/deployment).

## Pliki statyczne

Szablon trzyma `favicon.ico`, `robots.txt` i opublikowane pakiety zasobów w `public/`. Rapira wysyła każde żądanie do skryptu wejściowego, chyba że odpowie na nie [middleware plików statycznych](/pl/docs/static-files). Dodaj middleware do tabeli `[http]` w `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"
```

Domyślna lista `forbid` blokuje pliki `.php`, więc middleware nie serwuje `public/index.php`. Zasoby może też serwować CDN lub reverse proxy. Reguły serwowania opisuje [Integracja z frameworkami](/pl/docs/frameworks/#pliki-statyczne).

## Wyniki testów

Testy sprawdziły oba warianty tym samym zestawem testów na szablonie `yiisoft/app`. Wyniki są poniżej.

**Routing działa bez nadpisywania `$_SERVER`.** Rapira ustawia `SCRIPT_NAME` na `/worker.php`, czyli na nazwę skryptu wejściowego. FastRoute dopasował zagnieżdżone ścieżki z parametrami zapytania. Ścieżka główna zwróciła stronę główną szablonu. Nieznana ścieżka zwróciła odpowiedź `404` frameworka. Testy nie zmieniały `SCRIPT_NAME`, `REQUEST_URI` ani `DOCUMENT_ROOT`.

**Generowane adresy URL nie zawierają nazwy pliku workera.** `UrlGeneratorInterface::generate()` zwracał zwykłe ścieżki aplikacji.

**Yii3 izoluje sesję każdego klienta.** Jeden klient zachował swój licznik między żądaniami. Drugi klient dostał nową sesję. Trwały wariant kontenera dał ten sam wynik.

**Tokeny CSRF działają bez zmian.** `CsrfTokenMiddleware` z szablonu trzyma token w sesji, a testy potwierdziły jeden token dla każdego klienta. Każdy POST nadal wymaga swojego tokenu. Jeśli tryb Worker odrzuca POST, upewnij się, że formularz wysyła token. Nie zmieniaj skryptu workera z powodu tego błędu.

**Aplikacja otrzymuje dane formularzy, ciała JSON i przesyłane pliki.** `$_POST` zawierał pola formularza, a `php://input` zawierał ciało JSON. Plik tymczasowy przesłanego pliku był czytelny podczas żądania. `ServerRequest` w standardzie PSR-7 zawierał wszystkie te wartości.

**Wyjątek w akcji zwraca `500`, a worker działa dalej.** `ErrorCatcher` tworzy odpowiedź błędu i zapisuje wyjątek w logu. Ten sam worker normalnie obsługuje następne żądanie. Błędy, które zatrzymują workera, opisuje [tryb Worker](/pl/docs/worker).

## Tryb Classic jako alternatywa

Yii3 działa też ze zwykłym skryptem wejściowym. Zmień `rapira.toml` na tryb Classic:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Ta konfiguracja używa standardowego kodu aplikacji bez skryptu workera. Każde żądanie ma nowy stan aplikacji. Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic).

Zostaw `public/index.php` jako drugi skrypt wejściowy. Używają go tryb Classic i wbudowany serwer PHP.

::: question Czy muszę zmienić warunek `cli-server` w `public/index.php`?
Nie. Ten warunek serwuje pliki statyczne i zmienia `SCRIPT_NAME` dla wbudowanego serwera PHP. Rapira go nie uruchamia, bo `PHP_SAPI` ma wartość `fastcgi` na PHP 8.4 i `rapira` na PHP 8.5. Nazwę SAPI opisuje [Instalacja](/pl/docs/intro/installation).
:::
