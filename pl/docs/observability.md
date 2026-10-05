---
title: Metryki i kontrole stanu
description: "Proces [observability]: punkty końcowe /livez, /readyz i /metrics, sondy Kubernetes, pobieranie metryk przez Prometheus i opis metryk."
faqLevel: 2
---

# Metryki i kontrole stanu

Sekcja `[observability]` uruchamia jeszcze jeden proces, który serwuje sondy stanu i metryki Prometheus. Ten proces nie wykonuje PHP. Czyta stan workerów PHP z pamięci współdzielonej. Proces nadrzędny nadzoruje, przeładowuje i zatrzymuje go razem z workerami PHP. Proces nadrzędny i jego workery opisuje strona [Model procesów](/pl/docs/process-model).

Bez sekcji `[observability]` Rapira nie uruchamia tego procesu. Wersja dla Windows nie obsługuje tej sekcji i odrzuca ją jako nieznane pole.

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

[observability.probes]    # GET /livez i GET /readyz
```

`[observability.metrics]` i `[observability.probes]` nie przyjmują kluczy. Użyj adresu `listen`, którego nie używają nasłuchy `http` i `grpc`. Wszystkie klucze opisuje [sekcja `[observability]`](/pl/docs/configuration#observability).

Uruchom serwer, a następnie wyślij żądanie do każdego punktu końcowego:

```bash
curl -i http://127.0.0.1:9180/livez
curl -i http://127.0.0.1:9180/readyz
curl http://127.0.0.1:9180/metrics
```

Proces zapisuje wpisy logu z celem `observability`. Poziomy celów opisuje strona [Logi](/pl/docs/logging).

## Punkty końcowe

Proces serwuje HTTP/1.1 bez TLS. Odpowiada tylko na te żądania:

| Żądanie | Włącza je | Status | Treść |
| --- | --- | --- | --- |
| `GET /livez` | `[observability.probes]` | Zawsze `200` | `ok` |
| `GET /readyz` | `[observability.probes]` | `200` lub `503` | `ok` albo jedna linia `pool <name>: no ready worker` dla każdej puli, która nie jest gotowa |
| `GET /metrics` | `[observability.metrics]` | `200` | Format tekstowy Prometheus |

Każda inna metoda lub ścieżka dostaje `404` z pustą treścią. Ścieżka wyłączonej podtabeli też dostaje `404`. Każda linia treści kończy się znakiem nowej linii. Sondy używają typu treści `text/plain; charset=utf-8`. `/metrics` używa `text/plain; version=0.0.4; charset=utf-8`.

## Żywotność i gotowość

`/livez` nie wykonuje żadnych kontroli. Zwraca `200`, gdy proces odpowiada. Gdy proces nadrzędny się zatrzymuje, proces observability też się zatrzymuje. Dlatego odpowiedź `200` pokazuje, że proces nadrzędny działa. Proces nadrzędny sam zastępuje workery PHP po awarii, więc `/livez` ich nie sprawdza.

`/readyz` sprawdza każdą pulę PHP: najpierw `http`, potem `grpc`. Pula jest gotowa, gdy co najmniej jeden z jej workerów jest bezczynny lub obsługuje żądanie. Workery, które się uruchamiają lub kończą bieżące żądania przed wyjściem, nie są liczone. `/readyz` zwraca `503` w tych przypadkach:

- Workery puli się uruchamiają i jeszcze nie czekają na żądanie. W trybach Worker i Dispatcher skrypt wejściowy musi najpierw zakończyć rozruch.
- Rozruch skryptu wejściowego się nie udaje. Worker próbuje ponownie, a pula staje się gotowa po udanym rozruchu. Żądanie nie jest potrzebne.
- Przeładowanie uruchamia nowe workery, których rozruch się nie udaje. Po `process_control_timeout_secs` proces nadrzędny i tak zatrzymuje stare workery.
- Przez krótki czas każdy worker puli kończy bieżące żądania przed wyjściem, na przykład po `max_requests`, a żaden zastępca jeszcze nie czeka na żądanie.

Normalne przeładowanie utrzymuje `/readyz` na `200`. Proces nadrzędny uruchamia nowego workera, zanim zatrzyma starego. Kolejność przeładowania opisuje sekcja [Sygnały](/pl/docs/process-model#sygnały).

W niektórych przypadkach nie ma żadnej odpowiedzi. Na początku zatrzymywania proces observability przestaje przyjmować połączenia. Jeśli rozruch workerów puli się nie udaje, zanim pula obsłuży żądanie, proces nadrzędny kończy działanie z kodem `70`. Zobacz [Kody wyjścia](/pl/docs/cli#kody-wyjscia).

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

Wyjście zawiera te metryki. Etykieta `pool` ma wartość `http` lub `grpc`. Metryki nie obejmują procesu observability. Jednostka pracy to jedno żądanie HTTP lub jedno wywołanie gRPC.

| Metryka | Typ | Etykiety | Znaczenie |
| --- | --- | --- | --- |
| `rapira_workers` | gauge | `pool`, `state` | Workery w każdym stanie. Wartości `state` to `starting`, `idle`, `active` i `draining`. |
| `rapira_workers_configured` | gauge | `pool` | Wartość `processes` puli. |
| `rapira_requests_total` | counter | `pool` | Jednostki pracy, które workery zakończyły. Obejmuje jednostki nieudane. |
| `rapira_requests_failed_total` | counter | `pool` | Jednostki pracy, których host nie mógł zakończyć, na przykład utracone wywołanie lub jednostka odrzucona po przepełnieniu kolejki. |
| `rapira_requests_failed_on_full_queue_total` | counter | `pool` | Jednostki pracy, które zastały pełną kolejkę workera i nigdy do niej nie weszły. Rapira odrzuca taką jednostkę, gdy kolejka pozostaje pełna przez 30 sekund. |
| `rapira_requests_queued` | gauge | `pool` | Jednostki pracy, które czekają na wątek PHP workera. |
| `rapira_script_restarts_total` | counter | `pool` | Ponowne uruchomienia skryptu wejściowego wewnątrz procesu workera, na przykład po błędzie krytycznym. |
| `rapira_worker_exits_total` | counter | `pool`, `reason` | Zakończenia procesów workerów. Przyczyny opisuje tabela poniżej. |
| `rapira_worker_rss_bytes` | gauge | `pool`, `worker` | Pamięć rezydentna workera w bajtach. Tylko Linux. |
| `rapira_worker_pss_bytes` | gauge | `pool`, `worker` | Proporcjonalna pamięć workera w bajtach. Tylko Linux. |
| `rapira_build_info` | gauge | `version`, `php_version` | Wersja Rapiry i wersja dołączonego PHP. Wartość to zawsze `1`. |

Liczniki żądań opisują pracę PHP, a nie cały ruch nasłuchu. Wykluczają odrzucenia uwierzytelniania, nieprawidłowe żądania JSON, kontrole stanu i refleksję, które warstwa protokołu obsługuje przed przekazaniem do PHP. Host liczy zakończoną odpowiedź gRPC `fail()` jako obsłużoną bez błędu hosta. Późniejszy błąd konwersji odpowiedzi do JSON nie zwiększa licznika błędów. Dlatego `rapira_requests_failed_total` nie liczy statusów gRPC różnych od OK.

Etykieta `reason` metryki `rapira_worker_exits_total` ma te wartości:

| Przyczyna | Znaczenie |
| --- | --- |
| `drained` | Worker zakończył działanie z kodem `0`, na przykład po zatrzymaniu lub przeładowaniu. |
| `recycled` | Worker osiągnął `max_requests`. |
| `unhealthy` | Worker zgłosił, że nie może obsługiwać żądań, na przykład po powtarzających się nieudanych rozruchach. |
| `timeout` | Żądanie działało dłużej niż `request_terminate_timeout_secs`, a proces nadrzędny zatrzymał workera. |
| `crashed` | Worker zakończył działanie z innym kodem lub z powodu sygnału. |

Liczniki zachowują wartości, gdy proces nadrzędny zastępuje lub przeładowuje workera. Wracają do zera tylko po ponownym uruchomieniu procesu nadrzędnego. Jedno pobranie metryk czyta jeden plik `/proc` dla każdego działającego workera. Sondy nie czytają plików.

::: question Dlaczego etykieta worker nie jest identyfikatorem procesu?
Etykieta `worker` to numer miejsca workera w jego puli. Worker zastępczy może użyć tego samego miejsca, więc serie trwają dalej po zastąpieniu. Każda pula ma dwa miejsca na każdego workera. Dlatego numery mają wartości od `0` do dwukrotności `processes` minus jeden.
:::

::: question Dlaczego pula pokazuje więcej workerów niż rapira_workers_configured?
Podczas przeładowania proces nadrzędny uruchamia nowego workera, zanim zatrzyma starego. Oba workery są widoczne w `rapira_workers`, dopóki stary worker nie zakończy działania.
:::

## Bezpieczeństwo

Punkty końcowe nie mają uwierzytelniania ani TLS. `/metrics` pokazuje wersje Rapiry i PHP oraz pamięć każdego workera. Powiąż nasłuch z adresem pętli zwrotnej lub z adresem sieci prywatnej. Adres `:port` wiąże wszystkie interfejsy IPv4.

Nasłuch `unix:` tworzy swoje gniazdo z trybem `0666`. Kontroluj dostęp przez uprawnienia katalogu gniazda.

Konfigurację produkcyjną opisuje strona [Wdrożenie produkcyjne](/pl/docs/deployment).
