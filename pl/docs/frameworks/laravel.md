---
title: Laravel
description: "Uruchamianie Laravela na Rapirze w trybie Classic i aktualny stan wsparcia dla trybu Worker."
---

# Laravel

Rapira uruchamia Laravela w trybie Classic ze standardowym skryptem wejściowym `public/index.php`. Każde żądanie HTTP działa w nowym żądaniu PHP, jak w php-fpm. Aplikacja nie wymaga zmian. Rapira nie obsługuje jeszcze Laravela w [trybie Worker](#tryb-worker).

::: info Zweryfikowano na
- **PHP 8.5.8**: NTS, SAPI embed
- **Rapira 0.8.0**
- Aplikacja bazowa **laravel/laravel** z **laravel/framework v13.23.0**

Testy używały aplikacji bazowej `laravel/laravel` w trybie Classic z jednym workerem i dodatkowymi trasami. Sprawdzały trasowanie, sesje, przesyłanie plików, treści żądań, cache konfiguracji, cache tras, błędy oraz 50 kolejnych żądań. Przykłady na tej stronie używają formatu konfiguracji v0.9.
:::

## Wymagania

Zainstaluj Rapirę zgodnie z instrukcją [Instalacja](/pl/docs/intro/installation). Rapira dostarcza PHP jako bibliotekę, a nie jako polecenie `php`. Zainstaluj PHP CLI dla Composera i `artisan`. Rapira nie używa ani nie zmienia tego CLI.

Nowy projekt `laravel/laravel` używa SQLite oraz sterowników sesji, cache'u i kolejek opartych na bazie danych, więc wymaga `pdo_sqlite`. Wydania Rapiry zawierają `pdo_sqlite`. Pełną listę rozszerzeń zawiera [Instalacja](/pl/docs/intro/installation). Jeśli kompilujesz PHP, włącz rozszerzenia, których potrzebują twoje sterowniki. Zobacz [Budowanie ze źródeł](/pl/docs/intro/build-from-source).

Możesz też ustawić `SESSION_DRIVER=file`, `CACHE_STORE=file` i `QUEUE_CONNECTION=sync`. Testy tej strony używały tych ustawień.

## Uruchamianie serwera

Domyślny tryb to `dispatcher`, ale `public/index.php` Laravela nie ma pętli dispatchera. Ustaw `mode = "classic"` w `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4
```

Uruchom `rapira serve rapira.toml`, aby wystartować serwer. Względny `entrypoint` używa katalogu pliku konfiguracyjnego jako bazy. Wszystkie klucze i wartości domyślne opisuje [Konfiguracja](/pl/docs/configuration).

Aplikacja nie ma trwałego stanu, który trzeba resetować między żądaniami. PHP uruchamia się raz w procesie nadrzędnym, zanim proces nadrzędny utworzy workery. Dlatego wszystkie workery używają jednego OPcache dla kodu aplikacji i `vendor/`. W PHP 8.4 OPcache to osobny plik `opcache.so`, który wymaga linii `zend_extension` w [php.ini](/pl/docs/intro/installation#php-ini). Więcej informacji zawiera [tryb Classic](/pl/docs/classic).

Utwórz cache frameworka przed uruchomieniem produkcji. Testy potwierdziły oba cache w trybie Classic:

```bash
php artisan config:cache
php artisan route:cache
```

## Trasy i adresy URL

Rapira nie mapuje adresów URL na skrypty PHP. Każde żądanie uruchamia `public/index.php`, a Laravel trasuje ścieżkę z `$_SERVER['REQUEST_URI']`. Testy objęły trasowanie, stronę 404 Laravela i generowanie adresów przez `url()`. Wygenerowane adresy są bezwzględne i nie zawierają `index.php`. Nie wymagają nadpisywania `$_SERVER` ani zmian konfiguracji tras lub adresów URL.

Aby serwować zasoby z `public/`, włącz [middleware plików statycznych](/pl/docs/static-files). Dodaj `middleware` do istniejącej tabeli `[http]` i dodaj tabelę `[http.static]`. Rapira wymaga obu ustawień:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

Middleware odpowiada na żądania, które pasują do plików w `public/`. Wszystkie pozostałe żądania trafiają do Laravela. Zamiast tego zasoby może serwować CDN lub reverse proxy.

Wbudowana trasa `/up` zwraca `200`. Load balancer lub kontener może jej użyć do kontroli stanu. Rapira może też serwować `/livez` i `/readyz` pod osobnym adresem. Zobacz [Metryki i kontrole stanu](/pl/docs/observability).

Rapira przyjmuje tylko nieszyfrowany HTTP i pozostawia `$_SERVER['HTTPS']` puste, także gdy żądanie ma nagłówek `X-Forwarded-Proto`. Gdy [proxy kończy TLS](/pl/docs/deployment), skonfiguruj w Laravelu [zaufane proxy](https://laravel.com/docs/requests#configuring-trusted-proxies). Bez tej konfiguracji `url()` tworzy odnośniki `http://`.

## Sesje, CSRF i formularze

Testy używały plikowego sterownika sesji. Każdy klient otrzymał osobną sesję i wysłał jej ciasteczko w następnym żądaniu. CSRF nie wymaga konfiguracji Rapiry, ponieważ token jest w sesji.

Testy objęły też dane formularzy, treści JSON i przesyłanie plików. `http.max_body_size_mb` ogranicza treść żądania przed uruchomieniem PHP. Wartość domyślna to 8 MiB. Rapira zwraca `413` dla większej treści, a Laravel nie otrzymuje żądania. Aby przyjmować większe pliki, zwiększ tę wartość. Zwiększ też `post_max_size` i `upload_max_filesize` w php.ini. Zobacz [Treść żądania](/pl/docs/http#tresc-zadania).

Laravel zwrócił zwykłą odpowiedź `500` dla wyjątku w trasie. Następne żądanie działało normalnie i nie powtórzyło wyjątku.

## Tryb Worker

Rapira nie obsługuje jeszcze Laravela w trybie Worker. Uruchamiaj Laravela w trybie Classic.

Laravel przechowuje stan żądania w kontenerze, w rozwiązanych singletonach i we właściwościach statycznych. Worker musi zresetować ten stan przed następnym żądaniem. [Octane](https://laravel.com/docs/octane) wykonuje ten reset dla obsługiwanych serwerów, ale Rapira nie ma sterownika Octane. Aplikacje [Symfony](/pl/docs/frameworks/symfony) i [Yii3](/pl/docs/frameworks/yii3) mogą działać w trybie Worker.

::: warning
Własny worker Laravela bez pełnego resetu stanu może przekazać dane żądania, sesji lub uwierzytelniania z jednego żądania do późniejszego żądania. Nie używaj własnego workera bez pełnych testów izolacji stanu.
:::
