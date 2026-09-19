---
title: gRPC
description: "Skonfiguruj unarną usługę gRPC, napisz dyspozytora PHP i wywołaj usługę za pomocą grpcurl."
---

# gRPC

Rapira obsługuje natywny gRPC przez nieszyfrowany HTTP/2 na gniazdach TCP lub Unix. Każdy worker PHP obsługuje jedno wywołanie unarne naraz. Wywołanie unarne ma jeden komunikat żądania i jeden komunikat odpowiedzi.

Pula gRPC używa trybu Dispatcher. Rapira obsługuje transport i przekazuje do PHP binarne komunikaty protobuf. Metody strumieniowe aplikacji, gRPC-Web i Connect nie są obsługiwane. Proxy TLS musi używać HTTP/2 do połączenia z Rapirą.

## Uruchomienie usługi echo

Zainstaluj Rapirę z natywną obsługą gRPC. Zainstaluj [grpcurl](https://github.com/fullstorydev/grpcurl#installation), aby wykonać polecenia klienta. Ten przykład zwraca bajty żądania jako odpowiedź. Nie wymaga wygenerowanych klas PHP ani rozszerzenia gRPC dla PHP.

Utwórz następującą strukturę katalogów:

```text
app/
├── proto/
│   └── echo.proto
├── grpc.php
└── rapira.toml
```

### Definicja usługi

Zapisz ten schemat jako `proto/echo.proto`:

```protobuf
syntax = "proto3";

package example.v1;

option php_namespace = "Example\\V1";
option php_metadata_namespace = "Example\\Metadata";

service Echo {
  rpc Echo(EchoMessage) returns (EchoMessage);
}

message EchoMessage {
  string text = 1;
}
```

Rapira parsuje schemat przy uruchomieniu. Trasa to `/example.v1.Echo/Echo`. Kontekst PHP udostępnia metodę jako `example.v1.Echo/Echo`, bez początkowego ukośnika.

### Dyspozytor PHP

Zapisz ten skrypt jako `grpc.php`:

```php
<?php

use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;

$dispatcher = Rapira\get_dispatcher();

try {
    while (true) {
        $call = $dispatcher->receive();

        try {
            $metadata = $call->getResponseMetadata();
            $metadata->addHeader('x-worker', (string) getmypid());
            $metadata->addTrailer('x-result', 'echoed');
            $call->respond($call->getMessage());
        } catch (WorkDiscardedException) {
            continue;
        }
    }
} catch (ClosedException) {
    return;
}
```

Żądanie i odpowiedź mają ten sam typ komunikatu, więc handler może zwrócić bajty bezpośrednio. `ClosedException` kończy pętlę podczas zatrzymywania. `WorkDiscardedException` oznacza, że host już anulował wywołanie.

### Konfiguracja nasłuchu i puli

Zapisz tę konfigurację jako `rapira.toml`:

```toml
[grpc]
listen = "127.0.0.1:9001"
protos = ["proto"]
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`protos` zawiera katalogi. Rapira przeszukuje je rekurencyjnie w poszukiwaniu plików `.proto`. Ścieżki względne używają katalogu pliku konfiguracyjnego jako podstawy. Konfiguracja obsługująca tylko gRPC nie wymaga sekcji `[http]`.

Uruchom serwer z `app/`:

```sh
rapira serve rapira.toml
```

### Wywołanie usługi

Wyświetl listę usług w drugim terminalu:

```sh
grpcurl -plaintext 127.0.0.1:9001 list
```

Wywołaj metodę echo:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

Odpowiedź:

```json
{
  "text": "hello"
}
```

Te polecenia pobierają schematy przez refleksję. Dodaj `-v` przed adresem, aby sprawdzić nagłówki i nagłówki końcowe odpowiedzi.

## Użycie wygenerowanych komunikatów PHP

Wygeneruj klasy PHP, gdy handler musi odczytywać lub zmieniać pola komunikatu. Zainstaluj `protoc` i Composer na potrzeby tego etapu budowania. Serwer sam parsuje pliki `.proto` i nie wymaga programu `protoc` podczas działania.

Zainstaluj bibliotekę wykonawczą protobuf dla PHP w `app/`:

```sh
composer require google/protobuf
```

Utwórz katalog wynikowy:

```sh
mkdir -p generated
```

Wygeneruj klasy:

```sh
protoc --proto_path=proto --php_out=generated proto/echo.proto
```

Dodaj te mapowania przestrzeni nazw do obiektu `autoload.psr-4` w `composer.json`:

```json
{
  "autoload": {
    "psr-4": {
      "Example\\V1\\": "generated/Example/V1/",
      "Example\\Metadata\\": "generated/Example/Metadata/"
    }
  }
}
```

Zaktualizuj autoloader:

```sh
composer dump-autoload
```

Wczytaj go przed pętlą dyspozytora w `grpc.php`:

```php
require __DIR__ . '/vendor/autoload.php';
```

Zastąp linię z `respond()` w zagnieżdżonym bloku `try` następującym kodem:

```php
$message = new Example\V1\EchoMessage();
$message->mergeFromString($call->getMessage());
$message->setText(strtoupper($message->getText()));
$call->respond($message->serializeToString());
```

Uruchom ponownie przykładowy serwer. To samo wywołanie klienta zwraca teraz `{"text":"HELLO"}`. Przechwytuj wyjątki parsowania protobuf w handlerze aplikacji i zamieniaj je na `StatusCode::InvalidArgument`.

[Przewodnik po wygenerowanym kodzie PHP](https://protobuf.dev/reference/php/php-generated/) opisuje metody dostępu do pól i serializację. To API serwera nie wymaga rozszerzenia gRPC dla PHP.

## Kontrakt dyspozytora

`Rapira\get_dispatcher()` zwraca `Rapira\Grpc\GrpcDispatcher` w workerze gRPC. Zainicjalizuj autoloader i współdzielone usługi aplikacji przed pętlą.

| API | Działanie |
| --- | --- |
| `receive(int $timeout = -1)` | Zwraca następny `UnaryCall`. Limit oczekiwania jest podany w mikrosekundach. `-1` oznacza oczekiwanie bez limitu. Przekroczenie limitu rzuca `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Natychmiast zwraca `UnaryCall` lub `null`. |
| `getServices()` | Zwraca listę usług aplikacji oraz ich metod, typów wejściowych, typów wyjściowych i rodzajów metod. Dostępne przed pierwszym wywołaniem. |
| `$call->getContext()` | Zwraca metodę, metadane, adres klienta, protokół, czas odebrania i termin zakończenia. |
| `$call->getMessage()` | Zwraca bajty protobuf żądania jako ciąg znaków PHP. |
| `$call->respond(string $message)` | Kończy wywołanie jedną zserializowaną odpowiedzią protobuf. |
| `$call->fail(Status $status)` | Kończy wywołanie błędem gRPC. |
| `$call->isCancelled()` | Informuje o anulowaniu przez klienta lub przekroczeniu terminu zakończenia. |
| `$call->isFinalized()` | Informuje, czy wywołanie zostało zakończone. |

Zakończ aktywne wywołanie przed odebraniem następnego. Powtórne zakończenie rzuca `Rapira\Exception\AlreadyFinalizedError`. Odpowiedź po anulowaniu rzuca `WorkDiscardedException`. Usunięcie obiektu niezakończonego wywołania zwraca klientowi `INTERNAL`.

Użyj `$call->getContext()->method` do wyboru handlera, gdy schemat definiuje kilka metod. Usuwaj stan aplikacji związany z pojedynczym wywołaniem między iteracjami. Dyspozytor utrzymuje aplikację PHP w pamięci i nie wypełnia zmiennych superglobalnych HTTP.

## Zwracanie błędów i szczegółów

Użyj `fail()` dla oczekiwanego błędu aplikacji. Wykonaj ten kod w handlerze aktywnego wywołania:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` zawiera kody błędów gRPC. Udane `respond()` przekazuje status `OK`. Rapira zwraca status `INTERNAL` bez wewnętrznych szczegółów, gdy nieprzechwycony wyjątek pozostawia wywołanie niezakończone.

Opcjonalny trzeci argument `Status` to lista obiektów `Rapira\Grpc\ErrorDetail`. Każdy obiekt przyjmuje URL typu protobuf i bajty zserializowanego komunikatu. Rapira koduje te szczegóły w `grpc-status-details-bin`. `Rapira\Grpc\Exception\GrpcException` udostępnia właściwość `$status`, którą blok catch aplikacji może przekazać do `fail()`.

## Metadane

Odczytuj metadane żądania z `$call->getContext()->metadata`. `values($name)` zwraca wszystkie wartości dla nazwy bez rozróżniania wielkości liter. Tablica `entries`, dostępna tylko do odczytu, przechowuje nazwy małymi literami. Wartości nazw zakończonych na `-bin` są w PHP surowymi danymi binarnymi.

Dodawaj metadane odpowiedzi przed `respond()` lub `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` i `addTrailer()` przyjmują wartości złożone z drukowalnych znaków ASCII. Dla wartości binarnych użyj `addBinaryHeader()` lub `addBinaryTrailer()`. Wielokrotne dodanie zachowuje każdą wartość. Nazwy zarezerwowane przez transport, takie jak `grpc-status`, są odrzucane.

`headers()` i `trailers()` zwracają niezmienne migawki. Po zakończeniu wywołania metadanych odpowiedzi nie można zmienić. Przekaż metadane żądania opcją grpcurl `-H 'x-request-id: demo-1'`.

## Terminy zakończenia i anulowanie

Klient podaje termin zakończenia przez `grpc-timeout`. Rapira sprawdza ten termin podczas odbierania żądania i oczekiwania na PHP. `$call->getContext()->deadline` to uniksowy znacznik czasu w sekundach lub `null`. `receivedAt` to znacznik czasu odebrania w sekundach.

Na przykład ustaw klientowi termin zakończenia po dwóch sekundach:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

Kod PHP może działać dalej po anulowaniu. Sprawdzaj `isCancelled()` podczas długich operacji. Przechwytuj `WorkDiscardedException` przy wywoływaniu metod odpowiedzi, ponieważ anulowanie może nastąpić po sprawdzeniu.

Limit `receive()` określa, jak długo PHP czeka na nową pracę. Jest niezależny od terminu zakończenia wywołania. `grpc.pool.request_terminate_timeout_secs` nadzoruje czas działania procesu: kończy i zastępuje workera, gdy aktywne wywołanie przekroczy limit.

## Schematy i refleksja

Proces nadrzędny wczytuje schematy proto2 i proto3 przed forkowaniem workerów. Pliki znalezione w `protos` rejestrują usługi aplikacji. Pliki znalezione wyłącznie przez `import_paths` dostarczają typy zależności i dane refleksji.

Katalogi główne importów są używane w kolejności konfiguracji: najpierw `protos`, potem `import_paths`. Standardowe importy `google/protobuf` są wbudowane. Brakujące importy, sprzeczne definicje i metody strumieniowe aplikacji zatrzymują inicjalizację. Uruchom ponownie Rapirę po zmianie schematów.

Refleksja jest domyślnie włączona. Obsługuje `grpc.reflection.v1` i `grpc.reflection.v1alpha` w Rust. Zwraca listę usług aplikacji i usług refleksji oraz udostępnia deskryptory wraz z ich niestandardowymi opcjami. Metoda PHP `getServices()` zwraca tylko usługi aplikacji.

Przy `reflection = false` przekaż schemat klientowi:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

## Kompresja i limity komunikatów

Żądania skompresowane gzip są akceptowane. Kompresja gzip odpowiedzi jest domyślnie wyłączona. Włącz kompresję odpowiedzi aplikacji:

```toml
[grpc.compression.gzip]
enabled = true
```

Klient musi też zgłosić obsługę gzip w `grpc-accept-encoding`. Oba limity komunikatów mają domyślnie wartość 4 MiB. Ustaw `grpc.max_request_message_size_mb` i `grpc.max_response_message_size_mb`, aby je zmienić. Zarówno skompresowane, jak i nieskompresowane dane muszą mieścić się w skonfigurowanym limicie. Skonfiguruj limity klienta tak, aby akceptował oczekiwany rozmiar odpowiedzi.

## Wspólne uruchomienie HTTP i gRPC

Jedna konfiguracja może zawierać zarówno `[http]`, jak i `[grpc]`. Każda wtyczka ma własny nasłuch, skrypt wejściowy PHP i pulę workerów. Proces nadrzędny nadzoruje obie pule. Pula gRPC obsługuje te same ustawienia skalowania i wymiany workerów co pula HTTP, z `mode = "dispatcher"`.

Samodzielny plik binarny akceptuje pustą listę `grpc.interceptors`. Hosty napisane w Rust mogą dostarczać interceptory przez wspólne API `Middleware`. Wszystkie ustawienia gRPC opisuje [Konfiguracja](./configuration#grpc), a nadzór nad pulami opisuje [Model procesów](./process-model).
