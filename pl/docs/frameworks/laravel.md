---
title: Laravel
description: "Uruchamianie Laravela na Rapirze w trybie Classic i aktualny stan wsparcia dla trybu Worker."
---

# Laravel

Rapira uruchamia Laravela w trybie Classic ze standardowym skryptem `public/index.php`. Dla każdego żądania uruchamia nowe żądanie PHP, jak php-fpm. Aplikacja nie wymaga zmian. Tryb Worker dla Laravela jest rozwijany. Zobacz [Tryb Worker](#tryb-worker).

::: info Zweryfikowano na
- **PHP 8.5.8** - NTS, SAPI embed
- **Rapira 0.8.0**
- aplikacja bazowa **laravel/laravel** z **laravel/framework v13.23.0**

Testy używały aplikacji bazowej `laravel/laravel` z dodatkowymi trasami, w trybie Classic na jednym procesie roboczym. Sprawdzały trasowanie, sesje, przesyłanie plików, treści JSON i formularzy, cache konfiguracji i tras, odpowiedzi błędów oraz 50 kolejnych żądań.
:::

## Wymagania

Zainstaluj Rapirę zgodnie z instrukcją [Instalacja](/pl/docs/intro/installation). Potrzebujesz też działającej aplikacji Laravel. Zainstaluj PHP CLI dla Composera i `artisan`. Rapira dostarcza PHP jako bibliotekę, a nie polecenie `php`. Composer i `artisan` używają systemowego PHP CLI. Rapira nie używa ani nie zmienia tego CLI.

Sprawdź rozszerzenia bazy danych przed pierwszym uruchomieniem. Nowy projekt `laravel/laravel` używa SQLite dla bazy, sesji, cache'u i kolejek. Dlatego wymaga `pdo_sqlite`. Wydania Rapiry zawierają PDO, `pdo_sqlite` i `sqlite3`. Pełną listę zawiera [Instalacja](/pl/docs/intro/installation). Dołącz te rozszerzenia podczas własnej kompilacji PHP. Zobacz [Budowanie ze źródeł](/pl/docs/intro/build-from-source). Możesz też ustawić `SESSION_DRIVER=file`, `CACHE_STORE=file` i `QUEUE_CONNECTION=sync`. Testy tej strony używały tych ustawień.

## Uruchamianie Rapiry

Tryb Classic trzeba włączyć jawnie, więc polecenie wprost go nazywa:

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4

[http]
listen = "127.0.0.1:8000"
```

:::

Uruchom `rapira serve --config rapira.toml`, aby użyć pliku konfiguracyjnego. Względny `entrypoint` używa katalogu pliku. Wszystkie klucze opisuje [Konfiguracja](/pl/docs/configuration).

Rapira uruchamia nowe żądanie PHP dla każdego żądania HTTP. Dlatego cykl życia jest taki sam jak w php-fpm. Aplikacja nie ma trwałego stanu. PHP uruchamia się w procesie nadrzędnym przed utworzeniem workerów. OPcache zapewnia wspólny cache kodu aplikacji i `vendor/`. Zobacz [tryb Classic](/pl/docs/classic).

Utwórz cache frameworka przed uruchomieniem produkcji. Oba polecenia zweryfikowano w trybie Classic:

```bash
php artisan config:cache
php artisan route:cache
```

## Trasy i adresy URL

Rapira nie mapuje adresów URL na skrypty PHP. Każde żądanie uruchamia skrypt wejściowy. `$_SERVER['REQUEST_URI']` zawiera ścieżkę dla Laravela. [Middleware plików statycznych](/pl/docs/static-files) odpowiada na żądania plików. Pozostałe żądania uruchamiają skrypt wejściowy. Testy objęły trasy, stronę 404 i generowanie przez `url()`. Adresy są bezwzględne i nie zawierają `index.php`. Nie trzeba zmieniać `$_SERVER` ani konfiguracji adresów.

Trasa `/up` zwraca `200`. Load balancer lub kontener może użyć jej do kontroli stanu. Dla plików statycznych dodaj `"static"` do `http.middleware`. Ustaw `[http.static].root` na katalog `public/`. Rapira wymaga obu ustawień. Możesz też użyć CDN lub reverse proxy. Rapira przyjmuje nieszyfrowany HTTP i pozostawia `$_SERVER['HTTPS']` puste niezależnie od `X-Forwarded-Proto`. Gdy [proxy kończy TLS](/pl/docs/deployment), skonfiguruj [zaufane proxy](https://laravel.com/docs/requests#configuring-trusted-proxies). Bez tej konfiguracji `url()` tworzy odnośniki `http://`.

## Sesje, CSRF i formularze

Testy używały plikowego sterownika sesji. Każdy klient otrzymał osobną sesję i wysłał jej ciasteczko w następnym żądaniu. CSRF nie wymaga konfiguracji Rapiry, ponieważ token jest w sesji. Classic używa cyklu życia php-fpm. Testy objęły też formularze, treści JSON i pliki. Laravel zwrócił zwykłą odpowiedź `500` dla wyjątku. Laravel przetworzył kolejne żądanie normalnie.

## Tryb Worker

Tryb Worker dla Laravela jest rozwijany i nie jest jeszcze obsługiwany. Uruchamiaj Laravela w trybie Classic. Data wydania obsługi Worker nie jest dostępna.

Cykl życia frameworka wymaga specjalnej integracji. Laravel zmienia powiązania, singletony i stan statyczny podczas żądania. Ten stan trzeba zresetować przed kolejnym żądaniem. [Octane](https://laravel.com/docs/octane) wykonuje reset dla obsługiwanych serwerów. Rapira nie ma jeszcze sterownika Octane.

[Symfony](/pl/docs/frameworks/symfony) i [Yii3](/pl/docs/frameworks/yii3) obsługują trwałe aplikacje. Laravel wymaga własnego procesu resetowania stanu.

Własny worker Laravela musi zaimplementować pełny reset stanu Octane. Stan żądania znajduje się w kontenerze, singletonach rozwiązanych przez kontener, usługach żądania, usługach sesji, usługach uwierzytelniania i właściwościach statycznych. Niepełny reset może ujawnić dane starego żądania lub sesji w dowolnym późniejszym żądaniu, w tym w żądaniu tego samego użytkownika. Nie używaj takiego workera bez pełnych testów izolacji stanu.
