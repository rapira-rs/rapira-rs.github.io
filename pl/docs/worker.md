---
title: Tryb Worker
description: "Jak napisać skrypt workera Rapiry: pętla rezydentna, kontrakt handle_request(), co przeżywa między żądaniami i typowe pułapki."
faqLevel: 2
---

# Tryb Worker

Tryb Worker utrzymuje proces PHP przy życiu między żądaniami: skrypt raz podnosi aplikację, a potem kręci się w pętli i prosi Rapirę o kolejne żądanie. Rozruch wykonuje się jeden raz, przy starcie, a każde następne żądanie zastaje aplikację już rozgrzaną w pamięci. Stan również przeżywa żądanie, więc skrypt workera musi nim zarządzać.

W [trybie Classic](/pl/docs/classic) skrypt wejściowy wykonuje się od zera przy każdym żądaniu. Wszystko, co zbudował, zostaje odrzucone po wysłaniu odpowiedzi. Autoloader, kontener, konfiguracja, trasy i połączenia z bazą danych są uruchamiane dla każdego żądania.

Ta strona jest przewodnikiem po programowaniu w trybie Worker. Tryb Worker nie wymaga konkretnego frameworka, a jedynie aplikacji, która zniesie jednorazowy rozruch i obsługę wielu żądań, a to potrafi większość nowoczesnych frameworków. Trzy tryby oraz to, co decyduje o wyborze dostępnym danej aplikacji, opisują [Tryby wykonania](/pl/docs/execution-modes), a przewodniki po konkretnych frameworkach zebrano w sekcji [Frameworki](/pl/docs/frameworks/).

## Pętla rezydentna

Skrypt workera składa się z trzech części: tego, co podnosisz na samej górze, handlera obsługującego jedno żądanie i pętli, która kręci tym handlerem, dopóki worker nie zacznie się wygaszać. Pętlę piszesz w PHP, wokół wolnej funkcji `\Rapira\handle_request()`.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Domyślnym trybem jest Dispatcher. Tryb Worker włączysz na dwa równoważne sposoby:

- `--mode worker` w wierszu poleceń, obok skryptu wejściowego.
- `mode = "worker"` w sekcji `[pool]` pliku `rapira.toml`.

```bash
rapira serve --mode worker app/worker.php
```

Pozostałe flagi znajdziesz w [Wierszu poleceń](/pl/docs/cli), a ich odpowiedniki w `rapira.toml` w [Konfiguracji](/pl/docs/configuration).

## Kontrakt `handle_request()`

`\Rapira\handle_request(callable $handler): bool` to cały kontrakt między tobą a serwerem:

- **Blokuje wykonanie**, dopóki do tego workera nie trafi żądanie. Worker czekający w `handle_request()` nie zużywa procesora, a mimo to trzyma w pamięci swój interpreter i twoją podniesioną aplikację.
- **Wypełnia zmienne superglobalne** (`$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` i resztę) danymi tego żądania, od nowa, zanim ruszy twój handler. Zwykły kod PHP, który je czyta, działa dokładnie tak samo jak pod php-fpm.
- **Wywołuje twój handler bez żadnych argumentów.** Wszystko o żądaniu znajduje się w zmiennych superglobalnych, więc sygnatura callbacka to `function (): void`. Resztę, której handler potrzebuje (kontener, aplikację, logger), przechwytujesz przez `use`.
- **Twoje wyjście jest odpowiedzią.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()`: handler tworzy odpowiedź dokładnie tak samo jak klasyczny skrypt. O tym, jak podpięte są dane żądania i wypisywana odpowiedź, mówi [HTTP](/pl/docs/http).
- **Zwraca `true`**, gdy żądanie zostało obsłużone, czyli pętla kręci się dalej. Zwraca **`false`**, gdy worker się wygasza. To właśnie jest warunek pętli: kiedy zrobi się fałszywy, wypadasz z pętli i pozwalasz skryptowi się zakończyć.
- **Jej miejsce jest na najwyższym poziomie skryptu startowego.** Wywołuj ją z własnej pętli skryptu i znikąd indziej: wywołanie z funkcji shutdown albo z destruktora jest niezdefiniowane.

Żądanie w trybie Worker to więc jeden obrót twojej pętli `while`. Rapira domyka je wokół twojego handlera: uruchamia funkcje shutdown zarejestrowane w tym żądaniu, opróżnia i zeruje bufory wyjścia, zapisuje i zamyka sesję, a zmienne superglobalne wypełnia na nowo przed kolejnym obrotem. Wszystko, co twój skrypt trzyma poza handlerem, zostaje dokładnie tam, gdzie było. Rapira nie uruchamia na koniec żądania przebiegu destruktorów: obiekt ginie wtedy, gdy zniknie ostatnia referencja do niego.

## Jeden handler na worker

`handle_request()` wraca po każdym pojedynczym żądaniu, zamiast obsługiwać je w nieskończoność, więc przy życiu trzyma workera pętla wokół niego, a tę pętlę musi dostarczyć sam skrypt workera.

Skrypt workera obsługuje więc dokładnie jeden handler naraz. Jeśli napiszesz dwie pętle jedna po drugiej, do drugiej nigdy nie dojdziesz: pierwsza kończy się dopiero wtedy, gdy `handle_request()` zwróci `false`, a to znaczy, że worker już się wygasza. Rozdzielanie ruchu na różne ścieżki kodu robi w środku twój jeden handler; nie wyraża się tego kilkoma pętlami.

```php
while (\Rapira\handle_request($api)) {
}

// unreachable until shutdown
while (\Rapira\handle_request($web)) {
}
```

## Co przeżywa między żądaniami

Wszystko, co tworzysz **poza** handlerem, żyje tak długo jak proces workera: autoloader, kontener DI, skompilowane trasy, konfiguracja, otwarte połączenia z bazą i cache'em, rozgrzane pamięci podręczne. Nic z tego nie jest odbudowywane przy każdym żądaniu.

Wszystko, co tworzysz **wewnątrz** handlera, to zwykła praca na potrzeby jednego żądania, zwalniana w chwili, gdy handler wraca i znika ostatnia referencja.

To, gdzie przebiega granica między jednym a drugim, jest decyzją projektową skryptu workera: stan przeznaczony do współdzielenia ląduje powyżej pętli, a stan należący do jednego żądania zostaje w handlerze albo zostaje wyzerowany przed następnym.

::: warning
Współdzielony jest też stan globalny, czy tego chcesz, czy nie: statyczne właściwości, singletony, rejestry wypełniane leniwie przez biblioteki, `ini_set()`, którego nikt nie cofnął. Pod php-fpm żyły one w obrębie jednego żądania tylko dlatego, że zamykanie żądania w PHP zerowało je wszystkie: statyczne pola, zmienne globalne i `ini_set()` tak samo. Worker Rapiry celowo pomija to zerowanie między żądaniami, więc stan zostaje. Aplikacja, która nie potrafi zrezygnować ze stanu globalnego, działa zamiast tego w [trybie Classic](/pl/docs/classic): tryb Classic rezygnuje z rozgrzanej aplikacji, którą worker trzyma w pamięci, ale pozostaje zamiennikiem php-fpm bez żadnych zmian w kodzie, a na workera aplikacja przesiądzie się później, kiedy stan zostanie rozplątany.
:::

## Funkcje shutdown

Funkcja shutdown zarejestrowana przez skrypt przy rozruchu, poza pętlą, uruchamia się jeden raz, na koniec cyklu workera, czyli normalnie w chwili, gdy worker kończy pracę. Nie uruchamia się na koniec każdego żądania. Funkcja shutdown zarejestrowana przez handler w trakcie żądania uruchamia się na koniec tego żądania, raz, i już nigdy więcej.

Sprzątanie zasobów należących do całego procesu rejestruj przy rozruchu, a sprzątanie zasobów jednego żądania w handlerze.

```php
register_shutdown_function(static function (): void {
    // runs once, when the worker's cycle ends
});

$handler = static function (): void {
    register_shutdown_function(static function (): void {
        // runs at the end of this request
    });
};

while (\Rapira\handle_request($handler)) {
}
```

Na koniec cyklu jako pierwsze uruchamiają się rejestracje z rozruchu, w kolejności rejestrowania. Funkcja zarejestrowana przez skrypt już po pętli idzie za nimi.

Obiekty rządzą się inną regułą. Rapira nie uruchamia na koniec żądania przebiegu destruktorów. Obiekt ginie wtedy, gdy zniknie ostatnia referencja do niego, więc obiekt trzymany wyłącznie przez zmienną lokalną handlera ginie w chwili powrotu z handlera. Obiekt trzymany przez zmienną z poziomu rozruchu zostaje w pamięci między żądaniami, a jego `__destruct()` uruchamia się raz, na koniec cyklu.

::: question Dlaczego funkcja shutdown zarejestrowana przy rozruchu nie uruchamia się na koniec pierwszego żądania?
Lista funkcji shutdown jest w PHP stanem żądania: zamykanie żądania wywołuje funkcje z listy, a potem zwalnia samą listę. Rapira wyjmuje z niej rejestracje z rozruchu przy pierwszym wywołaniu `handle_request()` i trzyma je u siebie, więc każde żądanie zamyka się z listą, na której są wyłącznie jego własne rejestracje. Na koniec cyklu Rapira wstawia listę z rozruchu z powrotem i dokleja do niej to, co skrypt zarejestrował po pętli, dzięki czemu ostatnie zamknięcie uruchamia najpierw wpisy z rozruchu, w kolejności rejestrowania, a późniejsze zaraz po nich.
:::

## Tylko w trybie Worker

`handle_request()` potrzebuje rezydentnej pętli, którą ma wyłącznie tryb Worker. W trybie Classic i w trybie Dispatcher rzuca `Rapira\Exception\NotInWorkerModeError`. Każda klasa, którą rzuca Rapira, implementuje interfejs znacznikowy `Rapira\Exception\RapiraThrowable`, więc jeden `catch` obejmuje je wszystkie.

`Rapira\get_mode()` zwraca [tryb](/pl/docs/execution-modes) bieżącego procesu jako przypadek `Rapira\Mode`. Skrypt działający w więcej niż jednym trybie odczytuje go, zanim wejdzie w pętlę:

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## Pułapki

**Stan wyciekający między żądaniami.** Aplikacja, która psuje się w workerze, choć pod php-fpm działa bez zarzutu, zwykle przecieka stanem między żądaniami. Puchnąca tablica statyczna, obiekt żądania zapamiętany w singletonie, logger trzymający kontekst poprzedniego użytkownika: każde z nich to błąd, który wychodzi dopiero przy drugim żądaniu. Sprzątaj jawnie na początku albo na końcu handlera i zeruj to, co zostawiają po sobie biblioteki. `pool.max_requests` sprawia, że worker kończy pracę po N żądaniach, a proces nadrzędny podstawia w jego miejsce świeży, co ogranicza szkody z powolnego wycieku, ale go nie usuwa.

**Niezebrane cykle referencji.** Zliczanie referencji w PHP zwalnia większość rzeczy natychmiast, ale cykle znikają dopiero wtedy, gdy uruchomi się kolektor cykli. Wywołanie `gc_collect_cycles()` raz na obrót pętli, tak jak w skrypcie wyżej, nie jest wymagane, ale sprząta je w przewidywalnym momencie: między żądaniami, a nie w środku któregoś z nich.

**Żądania, które nigdy się nie kończą.** Worker uwięziony w zawieszonym żądaniu tkwi w nim w nieskończoność i przez ten czas nie obsługuje niczego innego. `pool.request_terminate_timeout_secs` nakłada na pojedyncze żądanie limit czasu rzeczywistego i ubija workera, który go przekroczy. Ten klucz i `pool.max_requests` opisuje [Konfiguracja](/pl/docs/configuration), a to, co proces nadrzędny robi po śmierci workera, [Model procesów](/pl/docs/process-model).

**Nieprzechwycony wyjątek dotyczy żądania, nie workera.** Nieprzechwycony wyjątek w handlerze kończy się odpowiedzią `500`, chyba że handler zdążył już wcześniej wysłać nagłówki odpowiedzi. Tak czy inaczej pętla kręci się dalej, więc wyjątek nie pociąga workera za sobą. Inaczej jest z błędem krytycznym: przerywa on rezydentny skrypt, więc worker uruchamia go od góry i jeszcze raz podnosi twoją aplikację.

**Praca po odesłaniu odpowiedzi.** Jeśli chcesz odesłać odpowiedź i pracować dalej, opróżnić kolejkę albo dopisać wpis do audytu, dokładnie do tego służy `rapira_finish_request()`. Opisuje ją strona [HTTP](/pl/docs/http).

## Stuby dla IDE

Funkcje i klasy, które Rapira wystawia do PHP, są zadeklarowane w plikach stubów w katalogu `crates/php_sys`. Powierzchnia workera leży w [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php), a klasy wyjątków w [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php). To wiążąca deklaracja API: sygnatury, typy właściwości i przeznaczenie każdej klasy. Przy okazji są to gotowe stuby dla IDE: wrzuć je do projektu, a edytor zacznie podpowiadać `\Rapira\handle_request()`, `\Rapira\get_mode()` i całą resztę, zamiast podkreślać je jako nieznane.
