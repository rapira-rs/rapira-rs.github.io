---
title: gRPC
description: "Obsługuj unarne wywołania gRPC, gRPC-Web i Connect dyspozytorem PHP i wywołuj je za pomocą grpcurl lub curl."
---

# gRPC

Rapira obsługuje unarne wywołania RPC w PHP. Jeden nasłuch akceptuje wywołania gRPC, gRPC-Web i Connect przez HTTP/1.1 lub nieszyfrowany HTTP/2, na gniazdach TCP lub Unix. Wywołanie unarne ma jeden komunikat żądania i jeden komunikat odpowiedzi.

Pula gRPC używa trybu Dispatcher. Rapira obsługuje transport i przekazuje do PHP binarne komunikaty protobuf. Każdy worker PHP obsługuje jedno wywołanie naraz. Metody strumieniowe nie są obsługiwane. Nasłuch nie obsługuje TLS.

## Uruchomienie usługi echo

Zainstaluj Rapirę. Zainstaluj [buf](https://buf.build/docs/installation/), aby zbudować zestaw deskryptorów, oraz [grpcurl](https://github.com/fullstorydev/grpcurl#installation), aby wykonać polecenia klienta. Ten przykład zwraca bajty żądania jako odpowiedź. Nie wymaga wygenerowanych klas PHP ani rozszerzenia gRPC dla PHP.

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

Trasa to `/example.v1.Echo/Echo`. Kontekst PHP udostępnia metodę jako `example.v1.Echo/Echo`, bez początkowego ukośnika.

### Budowanie zestawu deskryptorów

Rapira odczytuje schemat z zestawu deskryptorów: binarnego `google.protobuf.FileDescriptorSet`, który zawiera wszystkie importowane pliki. Zbuduj go w `app/`:

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

`protoc` również może go zbudować. Dodaj `--include_imports`, ponieważ bez tej opcji `protoc` nie dołącza importowanych plików:

```sh
protoc --include_imports --descriptor_set_out=api.binpb -I proto proto/echo.proto
```

Rapira nie wymaga programu `protoc` podczas działania.

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
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`descriptor_set` używa katalogu pliku konfiguracyjnego jako podstawy. Konfiguracja obsługująca tylko gRPC nie wymaga sekcji `[http]`.

Uruchom serwer z `app/`:

```sh
rapira serve rapira.toml
```

### Wywołanie usługi

Wyświetl listę usług w drugim terminalu:

```sh
grpcurl -plaintext 127.0.0.1:50051 list
```

Wywołaj metodę echo:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

Odpowiedź:

```json
{
  "text": "hello"
}
```

grpcurl pobiera schemat przez refleksję. Dodaj `-v` przed adresem, aby zobaczyć nagłówki i nagłówki końcowe odpowiedzi.

Klient Connect może wysłać JSON. Rapira zamienia żądanie JSON na binarny protobuf, zanim PHP je otrzyma, i zamienia binarną odpowiedź z powrotem na JSON:

```sh
curl -H 'Content-Type: application/json' -d '{"text":"hello"}' http://127.0.0.1:50051/example.v1.Echo/Echo
```

## Użycie wygenerowanych komunikatów PHP

Wygeneruj klasy PHP, gdy handler musi odczytywać lub zmieniać pola komunikatu. Zainstaluj `protoc` i Composer na potrzeby tego etapu budowania.

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

Uruchom ponownie przykładowy serwer. To samo wywołanie klienta zwraca teraz `{"text":"HELLO"}`. W handlerze aplikacji przechwytuj wyjątki parsowania protobuf i wysyłaj `StatusCode::InvalidArgument`.

[Przewodnik po wygenerowanym kodzie PHP](https://protobuf.dev/reference/php/php-generated/) opisuje metody dostępu do pól i serializację. To API serwera nie wymaga rozszerzenia gRPC dla PHP.

## Kontrakt dyspozytora

`Rapira\get_dispatcher()` zwraca `Rapira\Grpc\GrpcDispatcher` w workerze gRPC. Zainicjalizuj autoloader i współdzielone usługi aplikacji przed pętlą.

| API | Działanie |
| --- | --- |
| `receive(int $timeout = -1)` | Zwraca następny `UnaryCall`. Limit oczekiwania jest podany w mikrosekundach. `-1` oznacza oczekiwanie bez limitu. Przekroczenie limitu rzuca `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Zwraca `UnaryCall` lub `null`, gdy żadne wywołanie nie czeka. Nie czeka. |
| `getServices()` | Zwraca listę obsługiwanych usług oraz ich metod, typów wejściowych, typów wyjściowych i rodzajów metod. Metody strumieniowe są na liście. Dostępne przed pierwszym wywołaniem. |
| `$call->getContext()` | Zwraca metodę, metadane, adres klienta, protokół, czas odebrania i termin zakończenia. |
| `$call->getMessage()` | Zwraca komunikat żądania jako binarny protobuf w ciągu znaków PHP. |
| `$call->respond(string $message)` | Kończy wywołanie jedną zserializowaną odpowiedzią protobuf. |
| `$call->fail(Status $status)` | Kończy wywołanie statusem błędu gRPC. |
| `$call->isCancelled()` | Informuje o anulowaniu przez klienta, zamknięciu połączenia lub przekroczeniu terminu zakończenia. |
| `$call->isFinalized()` | Informuje, czy wywołanie zostało zakończone. |

Zakończ bieżące wywołanie przed odebraniem następnego. Gdy wywołanie jest otwarte, `receive()` rzuca `\Error`. Powtórne zakończenie rzuca `Rapira\Exception\AlreadyFinalizedError`. Odpowiedź po anulowaniu rzuca `WorkDiscardedException`.

Wywołanie, którego PHP nie zakończy, zostaje utracone. Klient otrzymuje wtedy `INTERNAL` z komunikatem `internal error`. Nieprzechwycony wyjątek także powoduje utratę wywołania, a klient nie widzi jego komunikatu.

Użyj `$call->getContext()->method` do wyboru handlera, gdy schemat definiuje kilka metod. `$call->getContext()->protocol` ma wartość `Grpc`, `GrpcWeb` lub `Connect`. Usuń stan aplikacji związany z wywołaniem przed następną iteracją. Dyspozytor nie wypełnia zmiennych superglobalnych HTTP.

## Zwracanie błędów i szczegółów

Użyj `fail()` dla oczekiwanego błędu aplikacji. Wykonaj ten kod w handlerze bieżącego wywołania:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` zawiera kody statusu gRPC. Udane `respond()` wysyła status `OK`. `fail()` to jedyny sposób wysłania statusu błędu.

Opcjonalny trzeci argument `Status` to lista obiektów `Rapira\Grpc\ErrorDetail`. Każdy obiekt przechowuje URL typu protobuf i bajty zserializowanego komunikatu. Dla gRPC i gRPC-Web Rapira wysyła szczegóły w `grpc-status-details-bin`. Dla Connect wysyła je w treści błędu JSON.

Rapira nie przechwytuje `Rapira\Grpc\Exception\GrpcException`. Przechwyć go i przekaż jego właściwość `$status` do `fail()`.

Klient otrzymuje `UNAVAILABLE`, gdy Rapira odrzuci wywołanie, zanim PHP je otrzyma. Dzieje się tak, gdy kolejka workerów pozostaje pełna przez 30 sekund, gdy pula się zatrzymuje lub gdy start PHP w workerze się nie powiódł.

## Metadane

Odczytuj metadane żądania z `$call->getContext()->metadata`. `values($name)` zwraca wszystkie wartości dla nazwy w kolejności nadejścia, bez rozróżniania wielkości liter w nazwie. Tablica `entries`, dostępna tylko do odczytu, przechowuje nazwy małymi literami.

Rapira usuwa z metadanych żądania nazwy transportowe, na przykład `grpc-timeout`, `content-type` i `te`. Odrzuca wartość tekstową, która nie jest drukowalnym ASCII. Dla nazwy zakończonej na `-bin` Rapira dzieli wartość według `,` i dekoduje każdy fragment z base64. PHP otrzymuje surowe bajty. Fragment, którego nie da się zdekodować, zostaje odrzucony.

Dodawaj metadane odpowiedzi przed `respond()` lub `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` i `addTrailer()` przyjmują wartości złożone z drukowalnych znaków ASCII. Pusta wartość jest dozwolona. Podczas wysyłania Rapira usuwa spacje z początku i końca wartości tekstowej. Dla wartości binarnych użyj `addBinaryHeader()` lub `addBinaryTrailer()`. Nazwa wartości binarnej musi kończyć się na `-bin`.

Nazwa metadanych może zawierać tylko `0-9`, `a-z`, `_`, `-` i `.`, zgodnie ze specyfikacją [protokołu gRPC](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#requests). Nazwa transportowa, nieprawidłowa nazwa lub nieprawidłowa wartość rzuca `\ValueError`. Powtórzona nazwa dodaje kolejną wartość.

`headers()` i `trailers()` zwracają migawki. Dla Connect każdy nagłówek końcowy jest nagłówkiem z prefiksem `trailer-`. Przekaż metadane żądania opcją grpcurl `-H 'x-request-id: demo-1'`.

## Terminy zakończenia i anulowanie

Klient ustawia limit czasu przez `grpc-timeout` (gRPC i gRPC-Web) lub `connect-timeout-ms` (Connect). `grpc.default_timeout_secs` ustawia limit czasu wywołania, dla którego klient nie podał limitu. `grpc.max_timeout_secs` skraca dłuższy limit klienta do swojej wartości. Oba klucze są domyślnie nieustawione, więc wywołanie bez limitu klienta nie ma terminu zakończenia.

`$call->getContext()->deadline` to termin zakończenia jako uniksowy znacznik czasu w sekundach lub `null`. `receivedAt` to czas, w którym Rapira odczytała cały komunikat żądania.

Na przykład ustaw klientowi termin zakończenia po dwóch sekundach:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

Po przekroczeniu terminu klient otrzymuje `DEADLINE_EXCEEDED`, a `isCancelled()` zwraca `true`. Rapira nie może zatrzymać kodu PHP, więc PHP kontynuuje wywołanie. Sprawdzaj `isCancelled()` podczas długich operacji. Przechwytuj `WorkDiscardedException` przy wywoływaniu metod odpowiedzi, ponieważ anulowanie może nastąpić po sprawdzeniu.

Limit `receive()` określa, jak długo PHP czeka na nową pracę. Jest niezależny od terminu zakończenia wywołania. `grpc.pool.request_terminate_timeout_secs` nadzoruje czas działania procesu. Zastępuje workera, gdy wywołanie trwa dłużej niż limit.

## Usługi i refleksja

Proces nadrzędny wczytuje zestaw deskryptorów przed forkowaniem workerów. Nieprawidłowy zestaw, zestaw bez importowanych plików lub nieznana usługa zatrzymuje start. Zmieniony zestaw wymaga zatrzymania i ponownego uruchomienia Rapiry. Przeładowanie zachowuje stary zestaw.

Domyślnie pula obsługuje usługi z plików, których nie importuje żaden inny plik zestawu. Plik importowany przez inny plik jest zależnością, na przykład `google/longrunning/operations.proto`. Jego usługi nie są obsługiwane. Ustaw `grpc.services`, aby wskazać obsługiwane usługi, na przykład `["billing.v1.InvoiceService"]`. Użyj tego klucza, gdy kilka instancji Rapira współdzieli jeden zestaw, lub aby obsłużyć usługę z importowanego pliku.

Metoda strumieniowa, metoda usługi, której pula nie obsługuje, oraz nieznana metoda zwracają `UNIMPLEMENTED`. Przy starcie Rapira zapisuje ostrzeżenie dla każdej metody strumieniowej obsługiwanej usługi.

Refleksja jest domyślnie wyłączona. Przy `reflection = true` Rust obsługuje `grpc.reflection.v1` i `grpc.reflection.v1alpha`. `ListServices` zwraca obsługiwane usługi. Każdy plik i symbol zestawu deskryptorów jest dostępny, więc każdy klient może odczytać cały zestaw.

Przy `reflection = false` przekaż schemat klientowi:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

## Kontrole stanu

Rust obsługuje [protokół kontroli stanu gRPC](https://github.com/grpc/grpc/blob/master/doc/health-checking.md) (`grpc.health.v1.Health`) w każdym workerze. `Check` i `Watch` zgłaszają `SERVING` dla pustej nazwy `""` i dla każdej obsługiwanej usługi. Podczas zatrzymywania zgłaszają `NOT_SERVING`.

Usługa health nie sprawdza PHP. Worker, w którym start PHP się nie powiódł, zgłasza `SERVING`, a jego wywołania otrzymują `UNAVAILABLE`. `grpc.services` nie może wskazywać usług health ani refleksji, ponieważ Rapira obsługuje je sama.

Refleksja nie wymienia usługi health. Żądanie Connect JSON nie wymaga schematu:

```sh
curl -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:50051/grpc.health.v1.Health/Check
```

## Protokoły i limity

- Żądanie Connect JSON, którego nie da się zdekodować, zwraca `INVALID_ARGUMENT`, a PHP nie otrzymuje wywołania. Dekoder JSON ignoruje nieznane pola. Nie ignoruje nazwy wartości enum, której zestaw deskryptorów nie deklaruje.
- Metoda z `option idempotency_level = NO_SIDE_EFFECTS;` akceptuje też żądanie Connect GET.
- Komunikaty mogą używać kompresji gzip. Żądanie z innym kodowaniem komunikatu zwraca `UNIMPLEMENTED`.
- Limit rozmiaru komunikatu wynosi 4 MiB. Większe żądanie zwraca `RESOURCE_EXHAUSTED`.
- `$call->getContext()->tls` ma zawsze wartość `null`. Umieść proxy TLS przed nasłuchem, gdy klienci potrzebują TLS. Dla natywnego gRPC proxy musi używać HTTP/2 do połączenia z Rapirą.
- Rapira wysyła keepalive PING HTTP/2 do bezczynnego połączenia co 10 sekund. Zamyka połączenie, które nie odpowie w ciągu 10 sekund.

::: warning Jedno połączenie używa jednego workera
Jeden proces workera obsługuje każde połączenie. Klient gRPC zwykle wysyła wszystkie wywołania kanału jednym połączeniem HTTP/2. Taki klient otrzymuje przepustowość jednego workera, niezależnie od rozmiaru puli. Aby użyć więcej workerów, otwórz kilka połączeń lub użyj load balancera L7, który rozdziela wywołania.
:::

## Wspólne uruchomienie HTTP i gRPC

Jedna konfiguracja może zawierać `[http]` i `[grpc]`. Każda wtyczka ma własny nasłuch, skrypt wejściowy PHP i pulę workerów. Proces nadrzędny nadzoruje obie pule. Pula gRPC obsługuje te same ustawienia skalowania i wymiany workerów co pula HTTP, z `mode = "dispatcher"`.

Wszystkie ustawienia gRPC opisuje [Konfiguracja](./configuration#grpc), a nadzór nad pulami opisuje [Model procesów](./process-model).

## Windows

[Wersja dla Windows](https://github.com/rapira-rs/rapira-windows) obsługuje ten sam nasłuch gRPC i to samo API PHP. Obowiązują te różnice:

- `grpc.listen` akceptuje tylko adres TCP.
- Pula gRPC to statyczna pula wątków interpretera PHP w jednym procesie. `grpc.pool.processes` ustawia liczbę wątków.
- `getmypid()` zwraca ten sam identyfikator procesu w każdym interpreterze.
- Błąd startu PHP w dowolnej puli zatrzymuje serwer z kodem wyjścia 70.
