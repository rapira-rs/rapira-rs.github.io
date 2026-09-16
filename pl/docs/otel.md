---
title: OpenTelemetry
description: "Natywne ślady, logi, metryki, eksport OTLP i kontekst śledzenia PHP."
---

# OpenTelemetry

Wtyczka `otel` eksportuje natywne ślady, logi i metryki przez OTLP z transportem HTTP/protobuf. Wtyczka `http` zarządza pulą workerów PHP. Wtyczka `otel` zarządza jednym procesem eksportera.

## Włączanie telemetrii

Dodaj tę sekcję do `rapira.toml`:

```toml
[otel]
enabled = true
endpoint = "http://localhost:4318"
service_name = "rapira"
sample_ratio = 1.0
```

Domyślna wartość `enabled` to `false`. Gdy telemetria jest wyłączona, API kontekstu śledzenia PHP zwracają puste tablice. Rapira odczytuje ustawienia telemetrii z TOML. Nie odczytuje zmiennych środowiskowych `OTEL_*`. Konfiguracja SDK PHP jest niezależna.

Funkcja Cargo `otel` w pakiecie głównym jest domyślnie włączona. Crate `otel` znajduje się w `crates/plugins/otel`. Aby zbudować program bez SDK i eksportera, użyj:

```sh
cargo build --release --no-default-features
```

Ten plik binarny odrzuca `[otel].enabled = true`. Wszystkie wartości domyślne i reguły walidacji opisuje [Konfiguracja](./configuration#otel).

Endpoint jest bazowym adresem URL HTTP lub HTTPS. Rapira dodaje `/v1/traces`, `/v1/logs` lub `/v1/metrics` po prefiksie ścieżki. Na przykład `https://collector.example/tenant` wysyła ślady do `https://collector.example/tenant/v1/traces`.

## Procesy i dostarczanie danych

Proces nadrzędny nadzoruje jeden proces potomny uruchomiony przez `exec`. Ten eksporter grupuje rekordy, ponawia żądania i wysyła OTLP. Jednowątkowy proces nadrzędny nie uruchamia eksportera sieciowego ani wątków SDK w tle.

Workery wysyłają rekordy bezpośrednio do eksportera przez nieblokujące lokalne strumienie Unix. Rekordy procesu nadrzędnego używają tego samego eksportera. Bufory o ograniczonym rozmiarze odrzucają rekordy przy przeciążeniu lub niedostępności eksportera. Wykonanie żądań nie czeka na eksport. Każdy zakodowany rekord IPC zajmuje mniej niż 1 MiB.

- Pełne rekordy, które eksporter już przyjął, pozostają u niego po awarii workera.
- Niewysłane rekordy i nieukończone spany przepadają wraz z workerem.
- Eksporter przechowuje kolejki w pamięci, bez trwałego zapisu.
- Awaria eksportera powoduje utratę rekordów z jego kolejek. Proces nadrzędny zastępuje eksporter, a producenci łączą się ponownie.
- Normalne zamknięcie wysyła oczekujące rekordy w czasie `export_timeout_secs`.
- Rekordy awarii procesów zawierają `worker_pid`, `pool` oraz `exit_code` lub `signal`.

Rapira nie zapisuje migawek żądań ani nie odtwarza śladów z pamięci współdzielonej. Proces nadrzędny nie śledzi działań PHP.

## Kontekst śledzenia i próbkowanie

Rapira kontynuuje przychodzący ślad na podstawie nagłówków W3C `traceparent` i `tracestate`. Brak lub nieprawidłowy kontekst nadrzędny rozpoczyna nowy ślad. Rapira łączy powtórzone pola `tracestate`. Natywne operacje otrzymują nowe lokalne identyfikatory spanów. PHP otrzymuje kontekst natywnego spanu `php.execute`.

`sample_ratio` steruje próbkowaniem śladów głównych. Sampler ParentBased uwzględnia przychodzący stan sampled lub unsampled. Używa `sample_ratio` tylko dla śladów bez rodzica. `traces`, `logs` i `metrics` są niezależnymi przełącznikami eksportu. Przy `traces = false` Rapira nadal przekazuje kontekst.

::: info Ograniczenie SDK
SDK Rust `opentelemetry` 0.32 odrzuca poprawne klucze multi-tenant `tracestate`, których identyfikator systemu ma dokładnie 14 znaków, na przykład `tenant@abcdefghijklmn`. Powoduje to odrzucenie całego `tracestate`. Identyfikator śladu i flaga sampled nadal są przekazywane. Zobacz [walidację w kodzie SDK](https://docs.rs/opentelemetry/0.32.0/src/opentelemetry/trace/span_context.rs.html) oraz [gramatykę klucza W3C](https://www.w3.org/TR/trace-context/#key).
:::

## Natywne sygnały

Natywne spany obejmują uruchamianie, przyjmowanie żądań, middleware, zbieranie treści, parsowanie multipart, `queue.wait` i `php.execute`. Obejmują także strumieniowe wysyłanie odpowiedzi, sendfile, wygaszanie i zamykanie workera.

| Metryka | Typ i jednostka | Atrybuty |
| --- | --- | --- |
| `http.server.request.duration` | Histogram, sekundy (`s`) | `http.request.method`, `http.response.status_code` |
| `rapira.operation.duration` | Histogram, sekundy (`s`) | `rapira.operation` |
| `rapira.otel.dropped_records` | Licznik, rekordy | Brak |

Ukończone żądania i natywne operacje wywołują tworzenie skumulowanych migawek metryk. Zasoby OTLP zawierają `service.name`, `process.pid` i `rapira.role`. Każdy proces ma też stały losowy `service.instance.id`. Zasoby workera zawierają też `rapira.pool`.

Rekordy logów są powiązane z aktywnym natywnym spanem. `[log]` i `RUST_LOG` sterują tylko filtrowaniem stderr. OTLP używa własnych przełączników sygnałów. Natywne spany nadal działają poniżej poziomu logowania stderr.

Diagnostyka eksportera i wewnętrznego SDK pozostaje w stderr i nie trafia ponownie do OTLP. Wszystkie procesy używają tych samych ustawień filtra i formatu stderr. Zobacz [Logi](./logging).

## Spany aplikacji PHP

Rapira udostępnia dwa nośniki kontekstu typu `array<string, string>`:

- `Rapira\Http\Request::$traceContext` zawiera natywny nośnik. `Request` jest klasą `final readonly`. Ostatni argument jej publicznego konstruktora to `array $traceContext`.
- Obiekty żądań tworzone przez hosta zachowują własny nośnik. Opóźnione utworzenie lub zachowany obiekt żądania utrzymuje kontekst tego żądania.
- `Rapira\trace_context(): array` zwraca nośnik aktywnego callbacku Worker lub wymiany Dispatcher. Poza aktywną pracą zwraca pustą tablicę.

Tryb Worker zachowuje natywny zakres podczas zamykania i zwalniania zasobów każdego zadania. Zakres Dispatcher kończy się przy finalizacji wymiany. Rust zachowuje kontekst żądania podczas wykonania PHP. PHP nie zwraca identyfikatora spanu do Rust.

PHP zarządza własnymi spanami potomnymi, aktywacją kontekstu, SDK, próbkowaniem, opróżnianiem buforów i eksporterem. Rapira nie instrumentuje automatycznie kodu PHP ani jego planisty Fiber. Dla współbieżnych Fiber użyj [obsługi kontekstu SDK PHP](https://opentelemetry.io/docs/languages/php/context/#context-in-asynchronous-environments).

### Przykład Dispatcher

Skonfiguruj SDK PHP przed uruchomieniem tego przykładu. Umieść konfigurację w `instrumentation.php`. Skorzystaj z oficjalnych instrukcji [konfiguracji SDK](https://opentelemetry.io/docs/languages/php/instrumentation/#initialize-the-sdk) i [eksporterów](https://opentelemetry.io/docs/languages/php/exporters/). Zarejestruj dostawcę śladów przed pętlą żądań. Skonfiguruj próbkowanie i opróżnianie buforów PHP dla swojej aplikacji.

Przykład odczytuje kontekst nadrzędny dla każdego żądania i tworzy span potomny PHP. Korzysta ze standardowego [API propagacji PHP](https://opentelemetry.io/docs/languages/php/propagation/#manual-context-propagation).

```php
<?php

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Context;
use Rapira\Exception\ClosedException;

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/instrumentation.php';

$tracer = Globals::tracerProvider()->getTracer('app');
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break;
    }

    $request = $exchange->getRequest();
    $parent = TraceContextPropagator::getInstance()->extract($request->traceContext, null, Context::getRoot());
    $span = $tracer->spanBuilder('app.handle')->setParent($parent)->startSpan();
    $scope = $span->activate();

    try {
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody("Hello\n");
    } finally {
        $scope->detach();
        $span->end();
    }
}
```

Odczytuj kontekst dla każdego żądania. Aktywuj kontekst dla tego żądania. Odłączaj zakres w `finally`. Kończ span w tym samym bloku. Globalny rodzic ustawiony raz przy uruchamianiu workera nie może identyfikować kolejnych żądań.

### Nośnik w trybie Worker

W callbacku `Rapira\handle_request()` odczytaj kontekst nadrzędny tak jak poniżej, z tym samym wzorcem spanu potomnego i `finally`:

```php
$parent = TraceContextPropagator::getInstance()->extract(\Rapira\trace_context(), null, Context::getRoot());
```

W tym callbacku używaj funkcji odpowiedzi Worker, takich jak `header()` i `echo`. Pętlę opisuje [Tryb Worker](./worker).
