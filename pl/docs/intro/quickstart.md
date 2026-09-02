---
title: Szybki start
description: "Obsługa aplikacji PHP na Rapirze w trybie klasycznym i w trybie workera oraz przeniesienie ustawień do pliku rapira.toml."
---

# Szybki start

Ta strona pokazuje, jak wystawić stronę w trybie klasycznym, zamienić tę samą aplikację w stale działający worker i przenieść ustawienia do pliku konfiguracyjnego. Zakłada, że masz działający plik binarny `rapira` razem z dołączonym do niego PHP; więcej informacji znajdziesz w [Instalacji](/pl/docs/intro/installation).

## Tryb klasyczny

Tryb klasyczny jest dostępny dla każdej aplikacji: przy każdym żądaniu Rapira na nowo dołącza twój skrypt wejściowy — dokładnie tak, jak php-fpm uruchamia front controller. Kod nie wymaga przy tym żadnych zmian.

Utwórz `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Uruchom serwer. Tryb wybiera flaga `--mode classic`, a argument pozycyjny to skrypt wejściowy:

```bash
rapira serve --mode classic public/index.php
```

Bez dodatkowych ustawień Rapira nasłuchuje na `127.0.0.1:8000`. Z drugiego terminala:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

Proces nie ginie między żądaniami — Rapira raz forkuje swoje workery i w każdym z nich trzyma uruchomiony interpreter PHP. Znika za to stan twojego skryptu: zmienne, autoloader, wszystko, co zbudował framework.

## Tryb workera

Tryb workera utrzymuje skrypt przy życiu. Startuje raz, a potem kręci się w pętli i prosi Rapirę o kolejne żądanie; Rapira wypełnia zmienne superglobalne i wywołuje twój handler. Kod PHP wygląda znajomo — nadal czytasz `$_GET` i wypisujesz odpowiedź przez `echo` — ale praca startowa wykonuje się raz na proces, a nie raz na żądanie. Więcej informacji znajdziesz w [Trybach wykonania](/pl/docs/execution-modes).

Utwórz `worker.php` w katalogu głównym projektu:

```php
<?php

// Outside the loop, so it survives every request this worker serves.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

`\Rapira\handle_request()` blokuje wykonanie aż do nadejścia kolejnego zadania, oddaje je twojemu callbackowi i zwraca `true`. Gdy worker się wygasza, zwraca `false` i to kończy pętlę. Callback czyta zmienne superglobalne i odpowiada przez `echo` oraz `header()`. Wywołuj `\Rapira\handle_request()` wyłącznie na najwyższym poziomie skryptu startowego. W każdym innym trybie funkcja rzuca `Rapira\Exception\NotInWorkerModeError`.

`\Rapira\handle_request()` pochodzi z modułu PHP, który Rapira rejestruje przy starcie interpretera, więc powyższy skrypt działa bez autoloadera. Aplikacja z zależnościami Composera ładuje własny `vendor/autoload.php` przed pętlą.

Najpierw zatrzymaj serwer w trybie Classic przez `Ctrl-C` w jego terminalu, bo oba zajmują `127.0.0.1:8000`. Domyślnym trybem jest Dispatcher, więc tryb workera trzeba włączyć flagą `--mode worker`:

```bash
rapira serve --mode worker worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Puść tego `curla` kilka razy: licznik rośnie, bo żądania obsługuje wciąż ten sam proces. Domyślnie Rapira forkuje po jednym workerze na logiczny rdzeń CPU, więc żądanie może trafić do dowolnego z nich, a o tym, który je odbierze, decyduje jądro systemu. Każdy worker liczy po swojemu, a pid w odpowiedzi mówi, który z nich odpowiedział. Jeśli chcesz, żeby licznik rósł jednym ciągiem, uruchom serwer poleceniem `rapira serve --mode worker --processes 1 worker.php`. O tym, jak nadzorowana jest pula, mówi [model procesów](/pl/docs/process-model).

Wszystko, co zbudujesz przed pętlą `while`, zostaje w pamięci przez całe życie workera: autoloader Composera, kontener DI, połączenia z bazą i cache'em, skompilowane trasy i szablony — wszystko to powstaje raz, przy starcie, a nie przy każdym żądaniu. Od nowa powstaje tylko stan związany z konkretnym żądaniem.

::: warning
Stan, który zostaje między żądaniami, musi resetować sam skrypt workera. Statyczna właściwość, zmienna globalna czy otwarta transakcja zostawiona przez jedno żądanie czekają na następne. [Tryb workera](/pl/docs/worker) opisuje, na co uważać i jak utrzymać workera w czystości.
:::

Wewnątrz handlera działają zwykłe funkcje — `header()`, `http_response_code()`, `echo` oraz `rapira_finish_request()`, które odsyła odpowiedź od razu i pozwala pracować dalej. Więcej informacji znajdziesz w [HTTP](/pl/docs/http).

## Plik konfiguracyjny

Ustawienia mogą trafić do pliku `rapira.toml` zamiast do wiersza poleceń. Na początek wystarczy plik obok kodu:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
Względną ścieżkę w `pool.entrypoint` Rapira liczy od katalogu samego pliku konfiguracyjnego, więc ten sam plik zadziała niezależnie od tego, w jakim katalogu akurat jesteś. Flagi wciąż mają pierwszeństwo przed plikiem — `rapira serve --config rapira.toml --processes 1` zachowa całą resztę i uruchomi tylko jeden worker.
:::

Plik przyjmuje też tryby skalowania puli, recykling workerów, limity czasu żądań, logowanie i pidfile supervisora. Nieznane klucze są odrzucane, a nie ignorowane, więc literówka przerwie start serwera, zamiast po cichu nic nie zmienić. Pełny opis znajdziesz w [Konfiguracji](/pl/docs/configuration), a flagi w [Wierszu poleceń](/pl/docs/cli).

## Zatrzymywanie serwera

Naciśnij `Ctrl-C`, a Rapira zacznie się wygaszać: przestanie przyjmować nową pracę, pozwoli dokończyć żądania będące już w toku, zamknie rozszerzenia i zakończy działanie. Drugie `Ctrl-C` pomija czekanie i wymusza wyjście, dzięki czemu zacięte żądanie nie blokuje serwera. `SIGTERM` działa tak samo i to dzięki temu restart z poziomu menedżera usług przebiega łagodnie. Pełną tabelę sygnałów — razem z przeładowaniem bez zrywania połączeń — znajdziesz w [Modelu procesów](/pl/docs/process-model).

## Co dalej

- [Tryb workera](/pl/docs/worker) — pętla workera od podszewki: stan, wycieki, recykling i sposób na wystartowanie prawdziwej aplikacji przed pętlą.
- [Konfiguracja](/pl/docs/configuration) — wszystkie klucze, które przyjmuje `rapira.toml`, wraz z wartościami domyślnymi.
- [Frameworki](/pl/docs/frameworks/) — przewodniki integracyjne dla Symfony, Laravela i Yii3.
