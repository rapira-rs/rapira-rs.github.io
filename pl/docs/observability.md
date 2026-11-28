---
title: Metryki i kontrole stanu
description: "Nasłuch [observability]: punkty końcowe /livez, /readyz i /metrics, sondy Kubernetes, pobieranie metryk przez Prometheus i opis metryk."
faqLevel: 2
---

# Metryki i kontrole stanu

Sekcja `[observability]` uruchamia nasłuch w osobnym wątku (`rapira-obs`) w procesie serwera, aby serwować sondy stanu i metryki Prometheus. Ten wątek nie wykonuje PHP i odczytuje liczniki pul bezpośrednio ze stanu wewnątrz procesu. Architekturę serwera opisuje strona [Model procesów](/pl/docs/process-model).

Bez sekcji `[observability]` Rapira nie uruchamia tego nasłuchu. Wersja dla Windowsa nie obsługuje tej sekcji i odrzuca ją jako nieznane pole.

## Włączanie punktów końcowych

Dodaj sekcję `[observability]` i co najmniej jedną z jej podtabel. Konfiguracja musi też zawierać `[http]` lub `[grpc]`. Ten minimalny `rapira.toml` włącza wszystkie punkty końcowe:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "index.php"

[observability]
listen = "127.0.0.1:9180"

[observability.metrics]   # GET /metrics

[observability.probes]    # GET /livez and GET /readyz
```

`[observability.metrics]` i `[observability.probes]` nie przyjmują kluczy. Użyj adresu `listen`, którego nie używają nasłuchy `http` i `grpc`. Wszystkie klucze opisuje [sekcja `[observability]`](/pl/docs/configuration#observability).

Uruchom serwer, a następnie wyślij żądanie do każdego punktu końcowego:

```bash
curl -i http://127.0.0.1:9180/livez
curl -i http://127.0.0.1:9180/readyz
curl http://127.0.0.1:9180/metrics
```

Nasłuch zapisuje wpisy logu z celem `observability`. Poziomy celów opisuje strona [Logi](/pl/docs/logging).

## Punkty końcowe

Nasłuch serwuje HTTP/1.1 bez TLS. Odpowiada tylko na te żądania:

| Żądanie | Włącza je | Status | Treść |
| --- | --- | --- | --- |
| `GET /livez` | `[observability.probes]` | Zawsze `200` | `ok` |
| `GET /readyz` | `[observability.probes]` | `200` lub `503` | `ok` albo jedna linia `pool <name>: no ready worker` dla każdej puli, która nie jest gotowa |
| `GET /metrics` | `[observability.metrics]` | `200` | Format tekstowy Prometheus |

Każda inna metoda lub ścieżka dostaje `404` z pustą treścią. Ścieżka wyłączonej podtabeli też dostaje `404`. Każda linia treści kończy się znakiem nowej linii. Sondy używają typu treści `text/plain; charset=utf-8`. `/metrics` używa `text/plain; version=0.0.4; charset=utf-8`.

## Żywotność i gotowość

`/livez` nie wykonuje żadnych kontroli. Zwraca `200`, gdy serwer odpowiada. Podczas zamykania nasłuch observability zatrzymuje się razem z serwerem.

`/readyz` sprawdza każdą pulę PHP: najpierw `http`, potem `grpc`. Pula jest gotowa, gdy co najmniej jeden z jej workerów jest bezczynny lub obsługuje jednostkę pracy. Workery, które się uruchamiają lub kończą pracę przed zatrzymaniem, nie są liczone. `/readyz` zwraca `503` w tych przypadkach:

- Workery puli się uruchamiają i jeszcze nie czekają na jednostkę pracy. W trybach Worker i Dispatcher skrypt wejściowy musi najpierw zakończyć rozruch.
- Rozruch skryptu wejściowego się nie udaje. Worker ponawia próby z narastającym opóźnieniem, a pula staje się gotowa po udanym rozruchu. Żądanie nie jest potrzebne.
- Każdy worker puli kończy pracę przed zatrzymaniem.

Przeładowanie utrzymuje `/readyz` na `200`, ponieważ wątki workerów nadal działają. Przeładowanie opisuje sekcja [Sygnały](/pl/docs/process-model#signals).

W niektórych przypadkach nie ma żadnej odpowiedzi. Na początku zatrzymywania nasłuch observability przestaje przyjmować połączenia. Jeśli worker osiągnie `max_boot_failures`, zanim jego pula obsłuży jednostkę pracy, serwer kończy działanie z kodem `70`. Zobacz [Kody wyjścia](/pl/docs/cli#exit-codes).

### Sondy Kubernetes

Kubelet wysyła sondy na adres IP poda, więc adres pętli zwrotnej nie działa. Powiąż nasłuch ze wszystkimi interfejsami poda. Nie dodawaj tego portu do obiektu Service.

```toml
[observability]
listen = ":9180"

[observability.probes]
```

```yaml
containers:
  - name: app
    image: registry.example.com/app:latest
    livenessProbe:
      httpGet:
        path: /livez
        port: 9180
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /readyz
        port: 9180
      periodSeconds: 5
```

## Metryki Prometheus

Serwer Prometheus na tym samym hoście może pobierać metryki z adresu pętli zwrotnej. Prometheus używa `/metrics` jako domyślnej wartości `metrics_path`.

```yaml
scrape_configs:
  - job_name: rapira
    static_configs:
      - targets: ["127.0.0.1:9180"]
```

Wyjście zawiera te metryki. Etykieta `pool` ma wartość `http` lub `grpc`. Jednostka pracy to jedno żądanie HTTP lub jedno wywołanie gRPC.

| Metryka | Typ | Etykiety | Znaczenie |
| --- | --- | --- | --- |
| `rapira_workers` | gauge | `pool`, `state` | Workery w każdym stanie. Wartości `state` to `starting`, `idle`, `active` i `draining`. |
| `rapira_workers_configured` | gauge | `pool` | Wartość `workers` puli. |
| `rapira_requests_total` | counter | `pool` | Jednostki pracy, które obsłużył worker lub odrzucił host. |
| `rapira_requests_failed_total` | counter | `pool` | Jednostki pracy, których host nie mógł zakończyć, na przykład utracone wywołanie lub jednostka odrzucona po przepełnieniu kolejki. |
| `rapira_requests_failed_on_full_queue_total` | counter | `pool` | Jednostki pracy, które zastały pełną kolejkę puli i nigdy do niej nie weszły. Rapira odrzuca taką jednostkę, gdy kolejka pozostaje pełna przez 30 sekund. |
| `rapira_requests_queued` | gauge | `pool` | Jednostki pracy, które czekają na workera w puli. |
| `rapira_script_restarts_total` | counter | `pool` | Ponowne uruchomienia aplikacji w wątkach workerów, na przykład po `max_requests`, przeładowaniu lub błędzie krytycznym. |
| `rapira_build_info` | gauge | `version`, `php_version` | Wersja Rapiry i wersja zlinkowanego PHP. Wartość to zawsze `1`. |

Liczniki żądań opisują pracę PHP, a nie cały ruch nasłuchu. Wykluczają odrzucenia uwierzytelniania, nieprawidłowe żądania JSON, kontrole stanu i refleksję, które warstwa protokołu obsługuje przed przekazaniem do PHP. Host liczy zakończoną odpowiedź gRPC `fail()` jako obsłużoną bez błędu hosta. Późniejszy błąd konwersji odpowiedzi do JSON nie zwiększa licznika błędów. Dlatego `rapira_requests_failed_total` nie liczy statusów gRPC różnych od OK.

Liczniki wracają do zera tylko po ponownym uruchomieniu serwera. Pobrania metryk i sondy odczytują liczniki wewnątrz procesu i nie czytają plików `/proc`.

## Bezpieczeństwo

Punkty końcowe nie mają uwierzytelniania ani TLS. `/metrics` pokazuje wersje Rapiry i PHP oraz metryki pul. Powiąż nasłuch z adresem pętli zwrotnej lub z adresem sieci prywatnej. Adres `:port` wiąże wszystkie interfejsy IPv4.

Nasłuch `unix:` tworzy swoje gniazdo z trybem `0666`. Kontroluj dostęp przez uprawnienia katalogu gniazda.

Konfigurację produkcyjną opisuje strona [Wdrożenie produkcyjne](/pl/docs/deployment).
