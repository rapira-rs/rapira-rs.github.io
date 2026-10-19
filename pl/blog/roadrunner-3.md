---
title: "RoadRunner 3"
date: 2026-10-19
description: "RoadRunner 3: zmiany w serwerze, nowe nazwy pakietów PHP pod roadrunner/*, los pluginu TCP, DLoad w roadrunner/cli i znany problem z Composerem."
author: Rapira Team
image: /blog/roadrunner-3/preview.png
---

# RoadRunner 3 wydany

Z przyjemnością ogłaszamy wydanie [RoadRunnera 3](https://github.com/roadrunner-server/roadrunner/releases/tag/v3.0.0).

RoadRunner 3 to ostatnia wersja major w dającej się przewidzieć przyszłości, z bardzo stabilnym API. Przy okazji tego wydania zamknęliśmy backlog z poprzednich wersji RoadRunnera i wróciliśmy do czytelnego schematu wersjonowania: zrezygnowaliśmy z wersji kalendarzowych na rzecz SemVer. RoadRunner 3 nadal będzie dostawał poprawki błędów i łatki bezpieczeństwa, ale zespół skupia się teraz przede wszystkim na rozwoju Rapiry.

Poniżej opisujemy, co zmieniło się w serwerze i pakietach PHP oraz jak przeprowadzić aktualizację.

## Najważniejsze zmiany

Pełną listę znajdziesz w [release notes](https://docs.roadrunner.dev/docs/releases/v3-0-0). W skrócie:

- **Pluginy w standardowym buildzie.** Doszły driver kolejek NSQ, rate limiting dla HTTP, kompresja Zstd i rejestr protobuf (Protoreg). Plugin TCP został usunięty.
- **HTTP.** Obsługa PROXY protocol v1 i v2 z jawną listą zaufanych proxy. Middleware `rate_limiter` zwraca `429` z nagłówkiem `Retry-After`. W `static` pojawiły się ustawienia cache'owania oraz komenda `rr reset static`.
- **gRPC.** Server reflection przez Protoreg oraz szczegóły `google.rpc.Status` w logach błędów.
- **Jobs.** Nazwane pule workerów: pipeline można przypisać do osobnej puli workerów PHP. AMQP obsługuje nazwane połączenia z różnymi brokerami. Kafka potrafi czytać tylko z wybranych partycji.
- **Lock.** Nowy backend Redis do blokad współdzielonych przez kilka instancji RoadRunnera.
- **Logger.** Logger korzysta teraz z `log/slog` z biblioteki standardowej Go, a zapis na wyjście nie blokuje.
- **Sockety uniksowe.** Dla listenerów i relay workerów można ustawić uprawnienia, właściciela i grupę.
- **Status.** `/livez` i `/readyz` działają jako aliasy `/health` i `/ready`.

## Breaking changes

Pełną listę kroków znajdziesz w [przewodniku migracji z v2025 do v3](https://docs.roadrunner.dev/docs/general/v3-migration). Najbardziej odczuwalne zmiany:

| Obszar               | Co się zmieniło                                                                                                                                                       |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| HTTP middleware      | Żądanie przechodzi przez `http.middleware` od lewej do prawej. Jeśli chcesz zachować dotychczasową kolejność, odwróć listę.                                           |
| HTTP/2               | Cleartext HTTP/2 działa wyłącznie w trybie prior knowledge. `Upgrade: h2c` nie jest już obsługiwany.                                                                  |
| AMQP                 | Ustawienia brokera trafiają do nazwanych połączeń, a `config.version` usunięto.                                                                                      |
| Logger               | Usunięto `file_logger_options` i wbudowaną rotację. Użyj `output` i zewnętrznego narzędzia do rotacji logów. Gdy kolejka się zapełni, nowe wpisy są odrzucane.        |
| Tracing              | Usunięto natywny eksporter Zipkin. Użyj OTLP.                                                                                                                         |
| RPC                  | Goridge v4 nie obsługuje MessagePack. Do wyboru są JSON, protobuf, Gob i raw.                                                                                        |
| Jobs                 | Nagłówek `pool` jest zarezerwowany do kierowania zadań do nazwanej puli. Domyślna wartość `pipeline_size` to teraz `100000`.                                          |
| NATS                 | Po zatrzymaniu pipeline'u stream jest domyślnie zachowywany.                                                                                                          |
| Centrifuge           | Usunięto metodę `centrifuge.RateLimit`.                                                                                                                               |
| `envfile`            | `envfile` z najwyższego poziomu konfiguracji ładuje się bez trybu experimental. Wskazany plik musi istnieć.                                                            |
| `server.on_init.env` | Te wartości nadpisują odziedziczone zmienne środowiskowe.                                                                                                              |
| Plugin TCP           | RoadRunner 3 go nie obsługuje.                                                                                                                                        |

Na najwyższym poziomie `.rr.yaml` nadal podajesz `version: "3"`. Do budowania ze źródeł potrzebujesz Go 1.27 lub nowszego. Autorzy pluginów w Go muszą przejść na `api-go/v6`, `api-plugins/v6`, `pool/v2`, `goridge/v4` i `*slog.Logger`. Velox, czyli narzędzie do budowania RoadRunnera, korzysta z nowego formatu konfiguracji modułów; usunięto z niego zdalny serwer buildów i targety dla Windowsa. Gotowe binarki dla Windowsa nadal są dostępne w wydaniu.


## Pakiety PHP

Razem z serwerem zaktualizowaliśmy pakiety PHP. Najważniejsze zmiany:

- Minimalna wersja PHP to 8.2.
- Wszystkie pakiety mają nowy vendor `roadrunner/*` (zamiast `spiral/*` i `roadrunner-php/*`).
- Przestrzenie nazw klas pozostały bez zmian, żeby zachować kompatybilność wsteczną.
- Każdy nowy pakiet deklaruje `replace` dla starej nazwy z `self.version`. Wyjątkiem jest metapakiet - piszemy o nim niżej.
- Metapakiet `spiral/roadrunner` nazywa się teraz `roadrunner/roadrunner`. Pakiety `roadrunner/*` wymagają `roadrunner/roadrunner ^3.0`. Zmiana nazwy pozwoliła nam pozbyć się kilku problemów:
  - Wersje kalendarzowe 2023.x–2025.x, niezgodne z SemVer, uparcie wyświetlały się jako najnowsze stabilne wydania. CalVer zostaje w `spiral/roadrunner`.
  - Security advisory [CVE-2025-22871](https://github.com/advisories/GHSA-g9pc-8g42-g6vq) oznacza jako podatne wersje `spiral/roadrunner < 2025.1.0`, przez co Composer blokował instalację RoadRunnera 3. Nowa nazwa nie niesie tego bagażu.
- Wszystkie pakiety wymagają RoadRunnera 3. Nie gwarantujemy, że starsze wersje RoadRunnera będą działać z nowymi pakietami.
- Plugin TCP wyleciał z RoadRunnera 3. Jeśli Twoja aplikacja korzysta z pluginu TCP, zalecamy pozostać na RoadRunnerze v2025. Nie dotyczy to transportu `tcp://` dla RPC i relay workerów - działa tak samo jak wcześniej.

Drobniejsze usprawnienia:

- Testy przepisaliśmy na [Testo](https://github.com/php-testo/testo).
- Poprawiliśmy wyniki Code Coverage, Mutation Testing i Static Analysis.
- RoadRunner CLI 3.0.0 pobiera binarki za pomocą [DLoad](https://github.com/php-internal/dload).

| Stara nazwa | Nowa nazwa | Status |
|---|---|---|
| `spiral/roadrunner` | `roadrunner/roadrunner` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/roadrunner.svg?label=)](https://packagist.org/packages/roadrunner/roadrunner) |
| `spiral/roadrunner-worker` | `roadrunner/worker` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/worker.svg?label=)](https://packagist.org/packages/roadrunner/worker) [![Psalm](https://shepherd.dev/github/roadrunner-php/worker/level.svg)](https://shepherd.dev/github/roadrunner-php/worker) [![Pokrycie](https://codecov.io/gh/roadrunner-php/worker/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/worker/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fworker%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/worker/3.x) |
| `spiral/roadrunner-http` | `roadrunner/http` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/http.svg?label=)](https://packagist.org/packages/roadrunner/http) [![Psalm](https://shepherd.dev/github/roadrunner-php/http/level.svg)](https://shepherd.dev/github/roadrunner-php/http) [![Pokrycie](https://codecov.io/gh/roadrunner-php/http/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/http/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fhttp%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/http/4.x) |
| `spiral/roadrunner-grpc` | `roadrunner/grpc` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/grpc.svg?label=)](https://packagist.org/packages/roadrunner/grpc) [![Psalm](https://shepherd.dev/github/roadrunner-php/grpc/level.svg)](https://shepherd.dev/github/roadrunner-php/grpc) [![Pokrycie](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgrpc%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/grpc/3.x) |
| `spiral/roadrunner-jobs` | `roadrunner/jobs` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/jobs.svg?label=)](https://packagist.org/packages/roadrunner/jobs) [![Psalm](https://shepherd.dev/github/roadrunner-php/jobs/level.svg)](https://shepherd.dev/github/roadrunner-php/jobs) [![Pokrycie](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fjobs%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/jobs/4.x) |
| `spiral/roadrunner-kv` | `roadrunner/kv` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/kv.svg?label=)](https://packagist.org/packages/roadrunner/kv) [![Psalm](https://shepherd.dev/github/roadrunner-php/kv/level.svg)](https://shepherd.dev/github/roadrunner-php/kv) [![Pokrycie](https://codecov.io/gh/roadrunner-php/kv/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/kv/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fkv%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/kv/4.x) |
| `spiral/roadrunner-metrics` | `roadrunner/metrics` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/metrics.svg?label=)](https://packagist.org/packages/roadrunner/metrics) [![Psalm](https://shepherd.dev/github/roadrunner-php/metrics/level.svg)](https://shepherd.dev/github/roadrunner-php/metrics) [![Pokrycie](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fmetrics%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/metrics/3.x) |
| `spiral/roadrunner-services` | `roadrunner/services` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/services.svg?label=)](https://packagist.org/packages/roadrunner/services) [![Psalm](https://shepherd.dev/github/roadrunner-php/services/level.svg)](https://shepherd.dev/github/roadrunner-php/services) [![Pokrycie](https://codecov.io/gh/roadrunner-php/services/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/services/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fservices%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/services/2.x) |
| `spiral/goridge` | `roadrunner/goridge` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/goridge.svg?label=)](https://packagist.org/packages/roadrunner/goridge) [![Psalm](https://shepherd.dev/github/roadrunner-php/goridge/level.svg)](https://shepherd.dev/github/roadrunner-php/goridge) [![Pokrycie](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgoridge%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/goridge/4.x) |
| `spiral/roadrunner-cli` | `roadrunner/cli` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/cli.svg?label=)](https://packagist.org/packages/roadrunner/cli) [![Psalm](https://shepherd.dev/github/roadrunner-php/cli/level.svg)](https://shepherd.dev/github/roadrunner-php/cli) [![Pokrycie](https://codecov.io/gh/roadrunner-php/cli/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/cli/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcli%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/cli/3.x) |
| `roadrunner-php/app-logger` | `roadrunner/app-logger` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/app-logger.svg?label=)](https://packagist.org/packages/roadrunner/app-logger) [![Psalm](https://shepherd.dev/github/roadrunner-php/app-logger/level.svg)](https://shepherd.dev/github/roadrunner-php/app-logger) [![Pokrycie](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fapp-logger%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/app-logger/1.x) |
| `roadrunner-php/centrifugo` | `roadrunner/centrifugo` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/centrifugo.svg?label=)](https://packagist.org/packages/roadrunner/centrifugo) [![Psalm](https://shepherd.dev/github/roadrunner-php/centrifugo/level.svg)](https://shepherd.dev/github/roadrunner-php/centrifugo) [![Pokrycie](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcentrifugo%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/centrifugo/2.x) |
| `roadrunner-php/lock` | `roadrunner/lock` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/lock.svg?label=)](https://packagist.org/packages/roadrunner/lock) [![Psalm](https://shepherd.dev/github/roadrunner-php/lock/level.svg)](https://shepherd.dev/github/roadrunner-php/lock) [![Pokrycie](https://codecov.io/gh/roadrunner-php/lock/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/lock/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Flock%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/lock/1.x) |
| `roadrunner-php/symfony-lock-driver` | `roadrunner/symfony-lock-driver` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/symfony-lock-driver.svg?label=)](https://packagist.org/packages/roadrunner/symfony-lock-driver) [![Psalm](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver/level.svg)](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver) [![Pokrycie](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fsymfony-lock-driver%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/symfony-lock-driver/1.x) |
| `roadrunner-php/version-checker` | `roadrunner/version-checker` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/version-checker.svg?label=)](https://packagist.org/packages/roadrunner/version-checker) [![Psalm](https://shepherd.dev/github/roadrunner-php/version-checker/level.svg)](https://shepherd.dev/github/roadrunner-php/version-checker) [![Pokrycie](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fversion-checker%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/version-checker/1.x) |
| `roadrunner-php/roadrunner-api-dto` | `roadrunner/api-dto` | [![Wersja](https://img.shields.io/packagist/v/roadrunner/api-dto.svg?label=)](https://packagist.org/packages/roadrunner/api-dto) |

Aby przeprowadzić migrację, podmień nazwy i wersje pakietów w `composer.json`.

## Jeszcze stabilniej

RoadRunner już wcześniej zapewniał najbardziej niezawodną integrację z PHP – bo co może być stabilniejsze niż STDIN/STDOUT? Mimo to w wersji 3 znaleźliśmy jeszcze coś do poprawienia: zużycie pamięci jest teraz bardziej równomierne, a wydajność znów nieco wzrosła.

![Zużycie pamięci RoadRunnera v2025, RoadRunnera v3 i dispatchera Rapiry przy rosnącym obciążeniu](/blog/roadrunner-3/benches.png)

Jeśli jednak potrzebujesz maksymalnej wydajności endpointów HTTP lub gRPC, być może nadszedł czas, by przyjrzeć się [Rapirze](/pl/docs/intro/).
