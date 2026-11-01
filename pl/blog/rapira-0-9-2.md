---
title: "Rapira 0.9.2"
date: 2026-11-01
description: "Restart aplikacji wewnątrz procesów roboczych, limity pamięci, poprawki HTTP i gRPC oraz Sodium w wydaniach."
author: Rapira Team
image: /blog/rapira-0-9-2/preview.jpg
---

# Rapira 0.9.2

Rapira 0.9.2 poprawia restart aplikacji w procesach roboczych, kontrolę wzrostu zużycia pamięci i kończenie żądań. To wydanie zmniejsza też koszt przetwarzania żądań i dodaje Sodium do pakietów PHP.

## Restart aplikacji z zachowaniem połączeń

W trybach worker i dispatcher parametr `max_requests` uruchamia teraz aplikację PHP ponownie w tym samym procesie roboczym. Proces roboczy ponownie wykonuje skrypt wejściowy. Otwarte połączenia i żądania w kolejce pozostają dostępne dla następnej instancji aplikacji.

Przeładowanie przez SIGHUP lub SIGUSR2 wysłany do procesu głównego działa w ten sam sposób. Tryb classic ignoruje te sygnały restartu aplikacji oraz `max_requests`, ponieważ każde żądanie już rozpoczyna nowy cykl obsługi żądania PHP.

Przeładowanie zachowuje bieżącą konfigurację i deskryptory gRPC. Uruchom Rapirę ponownie, aby wczytać zmienione pliki konfiguracji lub deskryptorów.

Gdy proces roboczy musi się zatrzymać, może odpowiedzieć na następne żądanie w każdym istniejącym połączeniu HTTP/1.1 przed jego zamknięciem. Dotyczy to też wywołań Connect i gRPC-Web, w ramach ustawionego czasu na zakończenie żądań.

## Limit pamięci dla każdego procesu roboczego

Nowy parametr `max_memory_mb` w `[http.pool]` i `[grpc.pool]` ustawia próg pamięci rezydentnej (RSS) w MiB. Proces główny sprawdza RSS raz na sekundę. Proces roboczy, który przekroczy próg, kończy obsługę połączeń i kończy działanie. Następnie proces główny uruchamia proces zastępczy. Wartość `0` wyłącza próg.

To uzupełnia restart aplikacji: wymiana procesu zwalnia pamięć, która może pozostać przydzielona między instancjami aplikacji.

## Pewniejsza obsługa żądań, mniej pracy

W trybie worker rozłączenie klienta kończy bieżące żądanie bez restartu aplikacji. Po przekroczeniu PHP `max_execution_time` proces roboczy nadal działa. Tryb classic kończy też odpowiedzi strumieniowe, gdy procedura obsługi wyjątku wywołuje `exit()`.

Poprawki HTTP obejmują przesyłanie plików, sprawdzanie długości w `sendFile()` i odpowiedzi HEAD. Pliki statyczne poprawnie obsługują `If-Range`. Surowe treści żądań oraz treści w formacie URL-encoded trafiają do PHP przez strumień w pamięci. Odczyt plików używa większych bloków, a bezczynne procesy robocze zwalniają nieużywaną pamięć alokatora po dwóch sekundach.

Odpowiedzi gRPC i gRPC-Web używają gzip tylko wtedy, gdy żądanie używało gzip. Odpowiedzi Connect mogą używać gzip, jeśli klient go akceptuje.

## Przed aktualizacją

- Usuń `unsafe_field_names` z `[http]`. Konfiguracje z tym parametrem powodują błąd przy uruchamianiu. Tryby classic i worker zawsze odrzucają nazwy nagłówków, które mogą powodować konflikty w zmiennych CGI.
- Usuń odwołania do `Rapira\Grpc\Call\Protocol::Rest`. Obsługiwane warianty to `Grpc`, `GrpcWeb` i `Connect`.
- Sprawdź PHP `memory_limit` dla aplikacji, które przyjmują duże treści żądań. Surowe treści oraz treści w formacie URL-encoded wliczają się teraz do tego limitu w trybach classic i worker.

Wydania i obrazy Docker zawierają teraz rozszerzenie Sodium. Archiwa dla Linuksa zawierają też biblioteki wymagane przez `libphp.so`.

Pełną listę zmian znajdziesz w [informacjach o wydaniu](https://github.com/rapira-rs/rapira/pull/211).
