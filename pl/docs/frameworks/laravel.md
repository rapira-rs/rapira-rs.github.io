---
title: Laravel
description: "Uruchamianie Laravela na Rapirze w trybie Classic i aktualny stan wsparcia dla trybu Worker."
---

# Laravel

Rapira uruchamia Laravela w trybie Classic: fabryczny front controller `public/index.php` wykonuje się od zera przy każdym żądaniu, dokładnie tak, jak robi to php-fpm. Aplikacja nie wymaga żadnych zmian. Tryb Worker dla Laravela jest w trakcie prac — jego aktualny stan opisuje sekcja [Tryb Worker](#tryb-worker) poniżej.

::: info Zweryfikowano na
- **PHP 8.5.8** — NTS, SAPI embed
- **Rapira 0.8.0**
- szkielet **laravel/laravel** z **laravel/framework v13.23.0**

Wszystko, co jest na tej stronie, sprawdziliśmy na szkielecie `laravel/laravel` z dorzuconą garstką testowych tras, w trybie Classic na jednym procesie roboczym: trasowanie, sesje, przesyłanie plików, treści JSON i formularzy, cache konfiguracji i tras, odpowiedzi błędów oraz 50 kolejnych żądań.
:::

## Wymagania

Potrzebujesz zainstalowanej Rapiry — patrz [Instalacja](/pl/docs/intro/installation) — i aplikacji Laravel, którą już potrafisz uruchomić. Potrzebujesz też zwykłego PHP CLI na maszynie: to przez niego uruchamiasz Composera i `artisan`. Rapira dostarcza PHP jako bibliotekę (`libphp`), a nie jako polecenie `php`, więc te kroki wykonują się na systemowym PHP, którego Rapira ani nie używa, ani nie rusza.

Przed pierwszym startem sprawdź rozszerzenia bazodanowe: świeży szkielet `laravel/laravel` domyślnie sięga po bazę SQLite oraz po sterowniki sesji, cache'u i kolejek oparte na bazie, a to znaczy, że potrzebuje `pdo_sqlite`. PHP dołączone do wydań Rapiry je ma: PDO, `pdo_sqlite` i `sqlite3` są w zestawie rozszerzeń wydanej binarki, wypisanym na stronie [Instalacja](/pl/docs/intro/installation). Jeśli uruchamiasz Rapirę na własnoręcznie skompilowanym PHP, dopilnuj tych rozszerzeń w linii configure (opisuje to [Budowanie ze źródeł](/pl/docs/intro/build-from-source)) albo zamiast tego przestaw Laravela na sterowniki plikowe i synchroniczne — `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`. Właśnie na takim zestawie działała weryfikacja opisana na tej stronie.

## Jak to uruchomić

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

Z plikiem konfiguracyjnym polecenie brzmi `rapira serve --config rapira.toml`, a względny `entrypoint` liczy się względem katalogu samego pliku konfiguracyjnego. Wszystkie klucze i ich wartości domyślne znajdziesz w [Konfiguracji](/pl/docs/configuration).

Rapira wykonuje front controller od zera przy każdym żądaniu, więc cykl życia frameworka jest dokładnie taki sam jak pod php-fpm: nie ma rezydentnego stanu ani niczego, co trzeba by zerować między żądaniami. Rozgrzany zostaje OPcache — PHP startuje raz, w procesie nadrzędnym, jeszcze zanim powstanie pierwszy worker, więc wszystkie workery korzystają ze wspólnego cache'u skompilowanych skryptów dla twojego kodu i całego drzewa `vendor/`. Mechanikę opisuje [tryb Classic](/pl/docs/classic).

Na produkcję zbuduj najpierw cache frameworka; oba polecenia sprawdziliśmy w trybie Classic, a ta sama bateria testów przechodziła bez cache'u i z cache'em:

```bash
php artisan config:cache
php artisan route:cache
```

## Trasy i adresy URL

Rapira nie mapuje adresów URL na skrypty PHP: każde żądanie uruchamia front controller, a ścieżkę do trasowania Laravel bierze z `$_SERVER['REQUEST_URI']`. Gdy włączysz [middleware plików statycznych](/pl/docs/static-files), odpowiada on na te żądania, które potrafi obsłużyć plikiem, a każde pozostałe uruchamia front controller. Trasowanie, własną stronę 404 Laravela dla niedopasowanych ścieżek i generowanie adresów przez `url()` — wszystko to sprawdziliśmy: powstają czyste adresy bezwzględne bez `index.php` w środku, bez nadpisywania czegokolwiek w `$_SERVER` i bez zmian w konfiguracji tras czy adresów.

Wbudowana w szkielet trasa `/up` odpowiada kodem `200`, więc nadaje się na cel health checku load balancera albo kontenera. Zasoby szkieletu Rapira serwuje przez [middleware plików statycznych](/pl/docs/static-files). Włącz go obiema połowami: wypisz `"static"` w `http.middleware` i ustaw `root` w sekcji `[http.static]` na katalog `public/` aplikacji. Z jedną połową bez drugiej Rapira odmawia startu. Zasoby może zamiast tego serwować CDN albo reverse proxy stojące z przodu. Nasłuch Rapiry mówi nieszyfrowanym HTTP i zostawia `$_SERVER['HTTPS']` puste niezależnie od `X-Forwarded-Proto`. Kiedy to proxy kończy TLS, skonfiguruj w Laravelu [zaufane proxy](https://laravel.com/docs/requests#configuring-trusted-proxies). Bez tej konfiguracji `url()` wygeneruje odnośniki `http://`.

## Sesje, CSRF i formularze

Sesje sprawdziliśmy na sterowniku plikowym: ciasteczko sesji wychodzi, wraca przy następnym żądaniu, a każdy klient dostaje własną sesję. CSRF nie wymaga żadnej konfiguracji — token siedzi w sesji, a każde żądanie dostaje tę samą semantykę świeżego procesu, którą daje php-fpm. Wysyłkę formularzy, treści żądań w JSON-ie i przesyłanie plików sprawdziliśmy na tym samym zestawie. Kiedy trasa rzuci wyjątkiem, handler wyjątków Laravela renderuje swoją zwykłą `500`, a kolejne żądanie nie odczuwa tego w żaden sposób.

## Tryb Worker

Tryb Worker dla Laravela jest w trakcie prac i nie jest jeszcze obsługiwany — uruchamiaj Laravela w trybie Classic. Nie ma jeszcze terminu, w którym pojawi się wsparcie dla trybu Worker.

Powodem jest cykl życia frameworka. Kontener Laravela nie jest zaprojektowany tak, żeby bez pomocy przetrwać drugie żądanie: powiązania zostają rozwiązane, singletony zapamiętują bieżące żądanie, statyczne pola frameworka zapełniają się w trakcie obsługi, więc to wszystko trzeba rozplątać, zanim przyjdzie kolejne żądanie. Tym rozplątywaniem zajmuje się [Octane](https://laravel.com/docs/octane) (`laravel/octane`), czyli własny pakiet Laravela dla długo działających serwerów. Octane działa tylko na serwerach, dla których ma sterownik, a Rapira nie ma jeszcze sterownika Octane.

Blokadą nie jest sam tryb: [Symfony](/pl/docs/frameworks/symfony) i [Yii3](/pl/docs/frameworks/yii3) trzymają swoje aplikacje rezydentnie w tym samym trybie [Worker](/pl/docs/worker). Brakuje właściwej dla Laravela obsługi stanu między żądaniami.

Własny skrypt workera dla Laravela możesz napisać, ale utrzymanie rezydentnej aplikacji oznacza ręczne odtworzenie tego, co Octane robi ze stanem: stan do rozplątania siedzi w kontenerze, w rozwiązanych singletonach, w stosie żądania, sesji i uwierzytelniania oraz w statycznych polach samego frameworka, a jeden pominięty element objawia się nieaktualnym obiektem żądania albo sesją jednego użytkownika widoczną dla następnego.
